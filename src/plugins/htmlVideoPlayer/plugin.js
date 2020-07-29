
define(['browser', 'require', 'events', 'apphost', 'loading', 'dom', 'playbackManager', 'appRouter', 'appSettings', 'connectionManager', 'htmlMediaHelper', 'itemHelper', 'screenfull', 'globalize'], function (browser, require, events, appHost, loading, dom, playbackManager, appRouter, appSettings, connectionManager, htmlMediaHelper, itemHelper, screenfull, globalize) {
    'use strict';

    function tryRemoveElement(elem) {
        const parentNode = elem.parentNode;
        if (parentNode) {
            // Seeing crashes in edge webview
            try {
                parentNode.removeChild(elem);
            } catch (err) {
                console.error('error removing dialog element: ' + err);
            }
        }
    }

    function enableNativeTrackSupport(currentSrc, track) {
        if (track) {
            if (track.DeliveryMethod === 'Embed') {
                return true;
            }
        }

        if (browser.firefox) {
            if ((currentSrc || '').toLowerCase().indexOf('.m3u8') !== -1) {
                return false;
            }
        }

        if (browser.ps4) {
            return false;
        }

        if (browser.web0s) {
            return false;
        }

        // Edge is randomly not rendering subtitles
        if (browser.edge) {
            return false;
        }

        if (browser.iOS) {
            // works in the browser but not the native app
            if ((browser.iosVersion || 10) < 10) {
                return false;
            }
        }

        if (track) {
            const format = (track.Codec || '').toLowerCase();
            if (format === 'ssa' || format === 'ass') {
                return false;
            }
        }

        return true;
    }

    function requireHlsPlayer(callback) {
        require(['hlsjs'], function (hls) {
            window.Hls = hls;
            callback();
        });
    }

    function getMediaStreamAudioTracks(mediaSource) {
        return mediaSource.MediaStreams.filter(function (s) {
            return s.Type === 'Audio';
        });
    }

    function getMediaStreamTextTracks(mediaSource) {
        return mediaSource.MediaStreams.filter(function (s) {
            return s.Type === 'Subtitle';
        });
    }

    function hidePrePlaybackPage() {
        const animatedPage = document.querySelector('.page:not(.hide)');
        animatedPage.classList.add('hide');
        // At this point, we must hide the scrollbar placeholder, so it's not being displayed while the item is being loaded
        document.body.classList.remove('force-scroll');
    }

    function zoomIn(elem) {
        return new Promise(function (resolve, reject) {
            const duration = 240;
            elem.style.animation = 'htmlvideoplayer-zoomin ' + duration + 'ms ease-in normal';
            hidePrePlaybackPage();
            dom.addEventListener(elem, dom.whichAnimationEvent(), resolve, {
                once: true
            });
        });
    }

    function normalizeTrackEventText(text, useHtml) {
        const result = text.replace(/\\N/gi, '\n').replace(/\r/gi, '');
        return useHtml ? result.replace(/\n/gi, '<br>') : result;
    }

    function getTextTrackUrl(track, item, format) {
        if (itemHelper.isLocalItem(item) && track.Path) {
            return track.Path;
        }

        let url = playbackManager.getSubtitleUrl(track, item.ServerId);
        if (format) {
            url = url.replace('.vtt', format);
        }

        return url;
    }

    function getDefaultProfile() {
        return new Promise(function (resolve, reject) {
            require(['browserdeviceprofile'], function (profileBuilder) {
                resolve(profileBuilder({}));
            });
        });
    }

    function HtmlVideoPlayer() {
        if (browser.edgeUwp) {
            this.name = 'Windows Video Player';
        } else {
            this.name = 'Html Video Player';
        }

        this.type = 'mediaplayer';
        this.id = 'htmlvideoplayer';

        // Let any players created by plugins take priority
        this.priority = 1;

        let videoDialog;

        let subtitleTrackIndexToSetOnPlaying;
        let audioTrackIndexToSetOnPlaying;

        let currentClock;
        let currentSubtitlesOctopus;
        let currentAssRenderer;
        let customTrackIndex = -1;

        let showTrackOffset;
        let currentTrackOffset;

        let videoSubtitlesElem;
        let currentTrackEvents;

        const self = this;

        self.currentSrc = function () {
            return self._currentSrc;
        };

        self._fetchQueue = 0;
        self.isFetching = false;

        function incrementFetchQueue() {
            if (self._fetchQueue <= 0) {
                self.isFetching = true;
                events.trigger(self, 'beginFetch');
            }

            self._fetchQueue++;
        }

        function decrementFetchQueue() {
            self._fetchQueue--;

            if (self._fetchQueue <= 0) {
                self.isFetching = false;
                events.trigger(self, 'endFetch');
            }
        }

        function updateVideoUrl(streamInfo) {
            const isHls = streamInfo.url.toLowerCase().indexOf('.m3u8') !== -1;

            const mediaSource = streamInfo.mediaSource;
            const item = streamInfo.item;

            // Huge hack alert. Safari doesn't seem to like if the segments aren't available right away when playback starts
            // This will start the transcoding process before actually feeding the video url into the player
            // Edit: Also seeing stalls from hls.js
            if (mediaSource && item && !mediaSource.RunTimeTicks && isHls && streamInfo.playMethod === 'Transcode' && (browser.iOS || browser.osx)) {
                const hlsPlaylistUrl = streamInfo.url.replace('master.m3u8', 'live.m3u8');

                loading.show();

                console.debug('prefetching hls playlist: ' + hlsPlaylistUrl);

                return connectionManager.getApiClient(item.ServerId).ajax({

                    type: 'GET',
                    url: hlsPlaylistUrl

                }).then(function () {
                    console.debug('completed prefetching hls playlist: ' + hlsPlaylistUrl);

                    loading.hide();
                    streamInfo.url = hlsPlaylistUrl;

                    return Promise.resolve();
                }, function () {
                    console.error('error prefetching hls playlist: ' + hlsPlaylistUrl);

                    loading.hide();
                    return Promise.resolve();
                });
            } else {
                return Promise.resolve();
            }
        }

        self.play = function (options) {
            self._started = false;
            self._timeUpdated = false;

            self._currentTime = null;

            self.resetSubtitleOffset();

            return createMediaElement(options).then(function (elem) {
                return updateVideoUrl(options).then(function () {
                    return setCurrentSrc(elem, options);
                });
            });
        };

        function setSrcWithFlvJs(instance, elem, options, url) {
            return new Promise(function (resolve, reject) {
                require(['flvjs'], function (flvjs) {
                    const flvPlayer = flvjs.createPlayer({
                        type: 'flv',
                        url: url
                    },
                    {
                        seekType: 'range',
                        lazyLoad: false
                    });

                    flvPlayer.attachMediaElement(elem);
                    flvPlayer.load();

                    flvPlayer.play().then(resolve, reject);
                    instance._flvPlayer = flvPlayer;

                    // This is needed in setCurrentTrackElement
                    self._currentSrc = url;
                });
            });
        }

        function setSrcWithHlsJs(instance, elem, options, url) {
            return new Promise(function (resolve, reject) {
                requireHlsPlayer(function () {
                    const hls = new Hls({
                        manifestLoadingTimeOut: 20000,
                        xhrSetup: function(xhr, xhr_url) {
                            xhr.withCredentials = true;
                        }
                    });
                    hls.loadSource(url);
                    hls.attachMedia(elem);

                    htmlMediaHelper.bindEventsToHlsPlayer(self, hls, elem, onError, resolve, reject);

                    self._hlsPlayer = hls;

                    // This is needed in setCurrentTrackElement
                    self._currentSrc = url;
                });
            });
        }

        function setCurrentSrc(elem, options) {
            elem.removeEventListener('error', onError);

            let val = options.url;
            console.debug('playing url: ' + val);

            // Convert to seconds
            const seconds = (options.playerStartPositionTicks || 0) / 10000000;
            if (seconds) {
                val += '#t=' + seconds;
            }

            htmlMediaHelper.destroyHlsPlayer(self);
            htmlMediaHelper.destroyFlvPlayer(self);
            htmlMediaHelper.destroyCastPlayer(self);

            subtitleTrackIndexToSetOnPlaying = options.mediaSource.DefaultSubtitleStreamIndex == null ? -1 : options.mediaSource.DefaultSubtitleStreamIndex;
            if (subtitleTrackIndexToSetOnPlaying != null && subtitleTrackIndexToSetOnPlaying >= 0) {
                const initialSubtitleStream = options.mediaSource.MediaStreams[subtitleTrackIndexToSetOnPlaying];
                if (!initialSubtitleStream || initialSubtitleStream.DeliveryMethod === 'Encode') {
                    subtitleTrackIndexToSetOnPlaying = -1;
                }
            }

            audioTrackIndexToSetOnPlaying = options.playMethod === 'Transcode' ? null : options.mediaSource.DefaultAudioStreamIndex;

            self._currentPlayOptions = options;

            const crossOrigin = htmlMediaHelper.getCrossOriginValue(options.mediaSource);
            if (crossOrigin) {
                elem.crossOrigin = crossOrigin;
            }

            if (htmlMediaHelper.enableHlsJsPlayer(options.mediaSource.RunTimeTicks, 'Video') && val.indexOf('.m3u8') !== -1) {
                return setSrcWithHlsJs(self, elem, options, val);
            } else if (options.playMethod !== 'Transcode' && options.mediaSource.Container === 'flv') {
                return setSrcWithFlvJs(self, elem, options, val);
            } else {
                elem.autoplay = true;

                // Safari will not send cookies without this
                elem.crossOrigin = 'use-credentials';

                return htmlMediaHelper.applySrc(elem, val, options).then(function () {
                    self._currentSrc = val;

                    return htmlMediaHelper.playWithPromise(elem, onError);
                });
            }
        }

        self.setSubtitleStreamIndex = function (index) {
            setCurrentTrackElement(index);
        };

        self.resetSubtitleOffset = function() {
            currentTrackOffset = 0;
            showTrackOffset = false;
        };

        self.enableShowingSubtitleOffset = function() {
            showTrackOffset = true;
        };

        self.disableShowingSubtitleOffset = function() {
            showTrackOffset = false;
        };

        self.isShowingSubtitleOffsetEnabled = function() {
            return showTrackOffset;
        };

        function getTextTrack() {
            const videoElement = self._mediaElement;
            if (videoElement) {
                return Array.from(videoElement.textTracks)
                    .find(function(trackElement) {
                        // get showing .vtt textTack
                        return trackElement.mode === 'showing';
                    });
            } else {
                return null;
            }
        }

        self.setSubtitleOffset = function(offset) {
            const offsetValue = parseFloat(offset);

            // if .ass currently rendering
            if (currentSubtitlesOctopus) {
                updateCurrentTrackOffset(offsetValue);
                currentSubtitlesOctopus.timeOffset = (self._currentPlayOptions.transcodingOffsetTicks || 0) / 10000000 + offsetValue;
            } else {
                const trackElement = getTextTrack();
                // if .vtt currently rendering
                if (trackElement) {
                    setTextTrackSubtitleOffset(trackElement, offsetValue);
                } else if (currentTrackEvents) {
                    setTrackEventsSubtitleOffset(currentTrackEvents, offsetValue);
                } else {
                    console.debug('No available track, cannot apply offset: ', offsetValue);
                }
            }
        };

        function updateCurrentTrackOffset(offsetValue) {
            let relativeOffset = offsetValue;
            const newTrackOffset = offsetValue;
            if (currentTrackOffset) {
                relativeOffset -= currentTrackOffset;
            }
            currentTrackOffset = newTrackOffset;
            // relative to currentTrackOffset
            return relativeOffset;
        }

        function setTextTrackSubtitleOffset(currentTrack, offsetValue) {
            if (currentTrack.cues) {
                offsetValue = updateCurrentTrackOffset(offsetValue);
                Array.from(currentTrack.cues)
                    .forEach(function(cue) {
                        cue.startTime -= offsetValue;
                        cue.endTime -= offsetValue;
                    });
            }
        }

        function setTrackEventsSubtitleOffset(trackEvents, offsetValue) {
            if (Array.isArray(trackEvents)) {
                offsetValue = updateCurrentTrackOffset(offsetValue) * 1e7; // ticks
                trackEvents.forEach(function(trackEvent) {
                    trackEvent.StartPositionTicks -= offsetValue;
                    trackEvent.EndPositionTicks -= offsetValue;
                });
            }
        }

        self.getSubtitleOffset = function() {
            return currentTrackOffset;
        };

        function isAudioStreamSupported(stream, deviceProfile) {
            const codec = (stream.Codec || '').toLowerCase();

            if (!codec) {
                return true;
            }

            if (!deviceProfile) {
                // This should never happen
                return true;
            }

            const profiles = deviceProfile.DirectPlayProfiles || [];

            return profiles.filter(function (p) {
                if (p.Type === 'Video') {
                    if (!p.AudioCodec) {
                        return true;
                    }

                    return p.AudioCodec.toLowerCase().indexOf(codec) !== -1;
                }

                return false;
            }).length > 0;
        }

        function getSupportedAudioStreams() {
            const profile = self._lastProfile;

            return getMediaStreamAudioTracks(self._currentPlayOptions.mediaSource).filter(function (stream) {
                return isAudioStreamSupported(stream, profile);
            });
        }

        self.setAudioStreamIndex = function (index) {
            const streams = getSupportedAudioStreams();

            if (streams.length < 2) {
                // If there's only one supported stream then trust that the player will handle it on it's own
                return;
            }

            let audioIndex = -1;
            let i;
            let length;
            let stream;

            for (i = 0, length = streams.length; i < length; i++) {
                stream = streams[i];

                audioIndex++;

                if (stream.Index === index) {
                    break;
                }
            }

            if (audioIndex === -1) {
                return;
            }

            const elem = self._mediaElement;
            if (!elem) {
                return;
            }

            // https://msdn.microsoft.com/en-us/library/hh772507(v=vs.85).aspx

            const elemAudioTracks = elem.audioTracks || [];
            console.debug('found ' + elemAudioTracks.length + ' audio tracks');

            for (i = 0, length = elemAudioTracks.length; i < length; i++) {
                if (audioIndex === i) {
                    console.debug('setting audio track ' + i + ' to enabled');
                    elemAudioTracks[i].enabled = true;
                } else {
                    console.debug('setting audio track ' + i + ' to disabled');
                    elemAudioTracks[i].enabled = false;
                }
            }
        };

        self.stop = function (destroyPlayer) {
            const elem = self._mediaElement;
            const src = self._currentSrc;

            if (elem) {
                if (src) {
                    elem.pause();
                }

                htmlMediaHelper.onEndedInternal(self, elem, onError);

                if (destroyPlayer) {
                    self.destroy();
                }
            }

            destroyCustomTrack(elem);

            return Promise.resolve();
        };

        self.destroy = function () {
            htmlMediaHelper.destroyHlsPlayer(self);
            htmlMediaHelper.destroyFlvPlayer(self);

            appRouter.setTransparency('none');

            const videoElement = self._mediaElement;

            if (videoElement) {
                self._mediaElement = null;

                destroyCustomTrack(videoElement);
                videoElement.removeEventListener('timeupdate', onTimeUpdate);
                videoElement.removeEventListener('ended', onEnded);
                videoElement.removeEventListener('volumechange', onVolumeChange);
                videoElement.removeEventListener('pause', onPause);
                videoElement.removeEventListener('playing', onPlaying);
                videoElement.removeEventListener('play', onPlay);
                videoElement.removeEventListener('click', onClick);
                videoElement.removeEventListener('dblclick', onDblClick);
                videoElement.removeEventListener('waiting', onWaiting);

                videoElement.parentNode.removeChild(videoElement);
            }

            const dlg = videoDialog;
            if (dlg) {
                videoDialog = null;
                dlg.parentNode.removeChild(dlg);
            }

            if (screenfull.isEnabled) {
                screenfull.exit();
            }
        };

        function onEnded() {
            destroyCustomTrack(this);
            htmlMediaHelper.onEndedInternal(self, this, onError);
        }

        function onTimeUpdate(e) {
            // get the player position and the transcoding offset
            const time = this.currentTime;

            if (time && !self._timeUpdated) {
                self._timeUpdated = true;
                ensureValidVideo(this);
            }

            self._currentTime = time;

            const currentPlayOptions = self._currentPlayOptions;
            // Not sure yet how this is coming up null since we never null it out, but it is causing app crashes
            if (currentPlayOptions) {
                let timeMs = time * 1000;
                timeMs += ((currentPlayOptions.transcodingOffsetTicks || 0) / 10000);
                updateSubtitleText(timeMs);
            }

            events.trigger(self, 'timeupdate');
        }

        function onVolumeChange() {
            htmlMediaHelper.saveVolume(this.volume);
            events.trigger(self, 'volumechange');
        }

        function onNavigatedToOsd() {
            const dlg = videoDialog;
            if (dlg) {
                dlg.classList.remove('videoPlayerContainer-onTop');

                onStartedAndNavigatedToOsd();
            }
        }

        function onStartedAndNavigatedToOsd() {
            // If this causes a failure during navigation we end up in an awkward UI state
            setCurrentTrackElement(subtitleTrackIndexToSetOnPlaying);

            if (audioTrackIndexToSetOnPlaying != null && self.canSetAudioStreamIndex()) {
                self.setAudioStreamIndex(audioTrackIndexToSetOnPlaying);
            }
        }

        function onPlaying(e) {
            if (!self._started) {
                self._started = true;
                this.removeAttribute('controls');

                loading.hide();

                htmlMediaHelper.seekOnPlaybackStart(self, e.target, self._currentPlayOptions.playerStartPositionTicks, function () {
                    if (currentSubtitlesOctopus) {
                        currentSubtitlesOctopus.timeOffset = (self._currentPlayOptions.transcodingOffsetTicks || 0) / 10000000 + currentTrackOffset;
                        currentSubtitlesOctopus.resize();
                        currentSubtitlesOctopus.resetRenderAheadCache(false);
                    }
                });

                if (self._currentPlayOptions.fullscreen) {
                    appRouter.showVideoOsd().then(onNavigatedToOsd);
                } else {
                    appRouter.setTransparency('backdrop');
                    videoDialog.classList.remove('videoPlayerContainer-onTop');

                    onStartedAndNavigatedToOsd();
                }
            }
            events.trigger(self, 'playing');
        }

        function onPlay(e) {
            events.trigger(self, 'unpause');
        }

        function ensureValidVideo(elem) {
            if (elem !== self._mediaElement) {
                return;
            }

            if (elem.videoWidth === 0 && elem.videoHeight === 0) {
                const mediaSource = (self._currentPlayOptions || {}).mediaSource;

                // Only trigger this if there is media info
                // Avoid triggering in situations where it might not actually have a video stream (audio only live tv channel)
                if (!mediaSource || mediaSource.RunTimeTicks) {
                    htmlMediaHelper.onErrorInternal(self, 'mediadecodeerror');
                    return;
                }
            }
        }

        function onClick() {
            events.trigger(self, 'click');
        }

        function onDblClick() {
            events.trigger(self, 'dblclick');
        }

        function onPause() {
            events.trigger(self, 'pause');
        }

        function onWaiting() {
            events.trigger(self, 'waiting');
        }

        function onError() {
            const errorCode = this.error ? (this.error.code || 0) : 0;
            const errorMessage = this.error ? (this.error.message || '') : '';
            console.error('media element error: ' + errorCode.toString() + ' ' + errorMessage);

            let type;

            switch (errorCode) {
                case 1:
                    // MEDIA_ERR_ABORTED
                    // This will trigger when changing media while something is playing
                    return;
                case 2:
                    // MEDIA_ERR_NETWORK
                    type = 'network';
                    break;
                case 3:
                    // MEDIA_ERR_DECODE
                    if (self._hlsPlayer) {
                        htmlMediaHelper.handleHlsJsMediaError(self);
                        return;
                    } else {
                        type = 'mediadecodeerror';
                    }
                    break;
                case 4:
                    // MEDIA_ERR_SRC_NOT_SUPPORTED
                    type = 'medianotsupported';
                    break;
                default:
                    // seeing cases where Edge is firing error events with no error code
                    // example is start playing something, then immediately change src to something else
                    return;
            }

            htmlMediaHelper.onErrorInternal(self, type);
        }

        function destroyCustomTrack(videoElement) {
            if (self._resizeObserver) {
                self._resizeObserver.disconnect();
                self._resizeObserver = null;
            }

            if (videoSubtitlesElem) {
                const subtitlesContainer = videoSubtitlesElem.parentNode;
                if (subtitlesContainer) {
                    tryRemoveElement(subtitlesContainer);
                }
                videoSubtitlesElem = null;
            }

            currentTrackEvents = null;

            if (videoElement) {
                const allTracks = videoElement.textTracks || []; // get list of tracks
                for (let i = 0; i < allTracks.length; i++) {
                    const currentTrack = allTracks[i];

                    if (currentTrack.label.indexOf('manualTrack') !== -1) {
                        currentTrack.mode = 'disabled';
                    }
                }
            }

            customTrackIndex = -1;
            currentClock = null;
            self._currentAspectRatio = null;

            const octopus = currentSubtitlesOctopus;
            if (octopus) {
                octopus.dispose();
            }
            currentSubtitlesOctopus = null;

            const renderer = currentAssRenderer;
            if (renderer) {
                renderer.setEnabled(false);
            }
            currentAssRenderer = null;
        }

        self.destroyCustomTrack = destroyCustomTrack;

        function fetchSubtitlesUwp(track, item) {
            return Windows.Storage.StorageFile.getFileFromPathAsync(track.Path).then(function (storageFile) {
                return Windows.Storage.FileIO.readTextAsync(storageFile).then(function (text) {
                    return JSON.parse(text);
                });
            });
        }

        function fetchSubtitles(track, item) {
            if (window.Windows && itemHelper.isLocalItem(item)) {
                return fetchSubtitlesUwp(track, item);
            }

            incrementFetchQueue();
            return new Promise(function (resolve, reject) {
                const xhr = new XMLHttpRequest();

                const url = getTextTrackUrl(track, item, '.js');

                xhr.open('GET', url, true);

                xhr.onload = function (e) {
                    resolve(JSON.parse(this.response));
                    decrementFetchQueue();
                };

                xhr.onerror = function (e) {
                    reject(e);
                    decrementFetchQueue();
                };

                xhr.send();
            });
        }

        function setTrackForDisplay(videoElement, track) {
            if (!track) {
                destroyCustomTrack(videoElement);
                return;
            }

            // skip if already playing this track
            if (customTrackIndex === track.Index) {
                return;
            }

            self.resetSubtitleOffset();
            const item = self._currentPlayOptions.item;

            destroyCustomTrack(videoElement);
            customTrackIndex = track.Index;
            renderTracksEvents(videoElement, track, item);
        }

        function renderSsaAss(videoElement, track, item) {
            const attachments = self._currentPlayOptions.mediaSource.MediaAttachments || [];
            const apiClient = connectionManager.getApiClient(item);
            const options = {
                video: videoElement,
                subUrl: getTextTrackUrl(track, item),
                fonts: attachments.map(function (i) {
                    return apiClient.getUrl(i.DeliveryUrl);
                }),
                workerUrl: appRouter.baseUrl() + '/libraries/subtitles-octopus-worker.js',
                legacyWorkerUrl: appRouter.baseUrl() + '/libraries/subtitles-octopus-worker-legacy.js',
                onError: function() {
                    htmlMediaHelper.onErrorInternal(self, 'mediadecodeerror');
                },
                timeOffset: (self._currentPlayOptions.transcodingOffsetTicks || 0) / 10000000,

                // new octopus options; override all, even defaults
                renderMode: 'blend',
                dropAllAnimations: false,
                libassMemoryLimit: 40,
                libassGlyphLimit: 40,
                targetFps: 24,
                prescaleTradeoff: 0.8,
                softHeightLimit: 1080,
                hardHeightLimit: 2160,
                resizeVariation: 0.2,
                renderAhead: 90
            };
            require(['JavascriptSubtitlesOctopus'], function(SubtitlesOctopus) {
                currentSubtitlesOctopus = new SubtitlesOctopus(options);
            });
        }

        function requiresCustomSubtitlesElement() {
            // after a system update, ps4 isn't showing anything when creating a track element dynamically
            // going to have to do it ourselves
            if (browser.ps4) {
                return true;
            }

            // This is unfortunate, but we're unable to remove the textTrack that gets added via addTextTrack
            if (browser.firefox || browser.web0s) {
                return true;
            }

            if (browser.edge) {
                return true;
            }

            if (browser.iOS) {
                const userAgent = navigator.userAgent.toLowerCase();
                // works in the browser but not the native app
                if ((userAgent.indexOf('os 9') !== -1 || userAgent.indexOf('os 8') !== -1) && userAgent.indexOf('safari') === -1) {
                    return true;
                }
            }

            return false;
        }

        function renderSubtitlesWithCustomElement(videoElement, track, item) {
            fetchSubtitles(track, item).then(function (data) {
                if (!videoSubtitlesElem) {
                    const subtitlesContainer = document.createElement('div');
                    subtitlesContainer.classList.add('videoSubtitles');
                    subtitlesContainer.innerHTML = '<div class="videoSubtitlesInner"></div>';
                    videoSubtitlesElem = subtitlesContainer.querySelector('.videoSubtitlesInner');
                    setSubtitleAppearance(subtitlesContainer, videoSubtitlesElem);
                    videoElement.parentNode.appendChild(subtitlesContainer);
                    currentTrackEvents = data.TrackEvents;
                }
            });
        }

        function setSubtitleAppearance(elem, innerElem) {
            require(['userSettings', 'subtitleAppearanceHelper'], function (userSettings, subtitleAppearanceHelper) {
                subtitleAppearanceHelper.applyStyles({
                    text: innerElem,
                    window: elem
                }, userSettings.getSubtitleAppearanceSettings());
            });
        }

        function getCueCss(appearance, selector) {
            let html = selector + '::cue {';

            html += appearance.text.map(function (s) {
                return s.name + ':' + s.value + '!important;';
            }).join('');

            html += '}';

            return html;
        }

        function setCueAppearance() {
            require(['userSettings', 'subtitleAppearanceHelper'], function (userSettings, subtitleAppearanceHelper) {
                const elementId = self.id + '-cuestyle';

                let styleElem = document.querySelector('#' + elementId);
                if (!styleElem) {
                    styleElem = document.createElement('style');
                    styleElem.id = elementId;
                    styleElem.type = 'text/css';
                    document.getElementsByTagName('head')[0].appendChild(styleElem);
                }

                styleElem.innerHTML = getCueCss(subtitleAppearanceHelper.getStyles(userSettings.getSubtitleAppearanceSettings(), true), '.htmlvideoplayer');
            });
        }

        function renderTracksEvents(videoElement, track, item) {
            if (!itemHelper.isLocalItem(item) || track.IsExternal) {
                const format = (track.Codec || '').toLowerCase();
                if (format === 'ssa' || format === 'ass') {
                    renderSsaAss(videoElement, track, item);
                    return;
                }

                if (requiresCustomSubtitlesElement()) {
                    renderSubtitlesWithCustomElement(videoElement, track, item);
                    return;
                }
            }

            let trackElement = null;
            if (videoElement.textTracks && videoElement.textTracks.length > 0) {
                trackElement = videoElement.textTracks[0];

                // This throws an error in IE, but is fine in chrome
                // In IE it's not necessary anyway because changing the src seems to be enough
                try {
                    trackElement.mode = 'showing';
                    while (trackElement.cues.length) {
                        trackElement.removeCue(trackElement.cues[0]);
                    }
                } catch (e) {
                    console.error('error removing cue from textTrack');
                }

                trackElement.mode = 'disabled';
            } else {
                // There is a function addTextTrack but no function for removeTextTrack
                // Therefore we add ONE element and replace its cue data
                trackElement = videoElement.addTextTrack('subtitles', 'manualTrack', 'und');
            }

            // download the track json
            fetchSubtitles(track, item).then(function (data) {
                // show in ui
                console.debug('downloaded ' + data.TrackEvents.length + ' track events');
                // add some cues to show the text
                // in safari, the cues need to be added before setting the track mode to showing
                data.TrackEvents.forEach(function (trackEvent) {
                    const trackCueObject = window.VTTCue || window.TextTrackCue;
                    const cue = new trackCueObject(trackEvent.StartPositionTicks / 10000000, trackEvent.EndPositionTicks / 10000000, normalizeTrackEventText(trackEvent.Text, false));

                    trackElement.addCue(cue);
                });
                trackElement.mode = 'showing';
            });
        }

        function updateSubtitleText(timeMs) {
            const clock = currentClock;
            if (clock) {
                try {
                    clock.seek(timeMs / 1000);
                } catch (err) {
                    console.error('error in libjass: ' + err);
                }
                return;
            }

            const trackEvents = currentTrackEvents;
            const subtitleTextElement = videoSubtitlesElem;

            if (trackEvents && subtitleTextElement) {
                const ticks = timeMs * 10000;
                let selectedTrackEvent;
                for (let i = 0; i < trackEvents.length; i++) {
                    const currentTrackEvent = trackEvents[i];
                    if (currentTrackEvent.StartPositionTicks <= ticks && currentTrackEvent.EndPositionTicks >= ticks) {
                        selectedTrackEvent = currentTrackEvent;
                        break;
                    }
                }

                if (selectedTrackEvent && selectedTrackEvent.Text) {
                    subtitleTextElement.innerHTML = normalizeTrackEventText(selectedTrackEvent.Text, true);
                    subtitleTextElement.classList.remove('hide');
                } else {
                    subtitleTextElement.classList.add('hide');
                }
            }
        }

        function setCurrentTrackElement(streamIndex) {
            console.debug('setting new text track index to: ' + streamIndex);

            const mediaStreamTextTracks = getMediaStreamTextTracks(self._currentPlayOptions.mediaSource);

            let track = streamIndex === -1 ? null : mediaStreamTextTracks.filter(function (t) {
                return t.Index === streamIndex;
            })[0];

            setTrackForDisplay(self._mediaElement, track);
            if (enableNativeTrackSupport(self._currentSrc, track)) {
                if (streamIndex !== -1) {
                    setCueAppearance();
                }
            } else {
                // null these out to disable the player's native display (handled below)
                streamIndex = -1;
                track = null;
            }
        }

        function createMediaElement(options) {
            return new Promise(function (resolve, reject) {
                const dlg = document.querySelector('.videoPlayerContainer');

                if (!dlg) {
                    require(['css!./style'], function () {
                        loading.show();

                        const dlg = document.createElement('div');

                        dlg.classList.add('videoPlayerContainer');

                        if (options.fullscreen) {
                            dlg.classList.add('videoPlayerContainer-onTop');
                        }

                        let html = '';
                        const cssClass = 'htmlvideoplayer';

                        // Can't autoplay in these browsers so we need to use the full controls, at least until playback starts
                        if (!appHost.supports('htmlvideoautoplay')) {
                            html += '<video class="' + cssClass + '" preload="metadata" autoplay="autoplay" controls="controls" webkit-playsinline playsinline>';
                        } else {
                            // Chrome 35 won't play with preload none
                            html += '<video class="' + cssClass + '" preload="metadata" autoplay="autoplay" webkit-playsinline playsinline>';
                        }

                        html += '</video>';

                        dlg.innerHTML = html;
                        const videoElement = dlg.querySelector('video');

                        videoElement.volume = htmlMediaHelper.getSavedVolume();
                        videoElement.addEventListener('timeupdate', onTimeUpdate);
                        videoElement.addEventListener('ended', onEnded);
                        videoElement.addEventListener('volumechange', onVolumeChange);
                        videoElement.addEventListener('pause', onPause);
                        videoElement.addEventListener('playing', onPlaying);
                        videoElement.addEventListener('play', onPlay);
                        videoElement.addEventListener('click', onClick);
                        videoElement.addEventListener('dblclick', onDblClick);
                        videoElement.addEventListener('waiting', onWaiting);
                        if (options.backdropUrl) {
                            videoElement.poster = options.backdropUrl;
                        }

                        document.body.insertBefore(dlg, document.body.firstChild);
                        videoDialog = dlg;
                        self._mediaElement = videoElement;

                        // don't animate on smart tv's, too slow
                        if (options.fullscreen && browser.supportsCssAnimation() && !browser.slow) {
                            zoomIn(dlg).then(function () {
                                resolve(videoElement);
                            });
                        } else {
                            hidePrePlaybackPage();
                            resolve(videoElement);
                        }
                    });
                } else {
                    resolve(dlg.querySelector('video'));
                }
            });
        }
    }

    HtmlVideoPlayer.prototype.canPlayMediaType = function (mediaType) {
        return (mediaType || '').toLowerCase() === 'video';
    };

    HtmlVideoPlayer.prototype.supportsPlayMethod = function (playMethod, item) {
        if (appHost.supportsPlayMethod) {
            return appHost.supportsPlayMethod(playMethod, item);
        }

        return true;
    };

    HtmlVideoPlayer.prototype.getDeviceProfile = function (item, options) {
        const instance = this;
        return getDeviceProfileInternal(item, options).then(function (profile) {
            instance._lastProfile = profile;
            return profile;
        });
    };

    function getDeviceProfileInternal(item, options) {
        if (appHost.getDeviceProfile) {
            return appHost.getDeviceProfile(item, options);
        }

        return getDefaultProfile();
    }

    let supportedFeatures;

    function getSupportedFeatures() {
        const list = [];

        const video = document.createElement('video');
        if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === 'function' || document.pictureInPictureEnabled) {
            list.push('PictureInPicture');
        } else if (window.Windows) {
            if (Windows.UI.ViewManagement.ApplicationView.getForCurrentView().isViewModeSupported(Windows.UI.ViewManagement.ApplicationViewMode.compactOverlay)) {
                list.push('PictureInPicture');
            }
        }

        if (browser.safari || browser.iOS || browser.iPad) {
            list.push('AirPlay');
        }

        if (typeof video.playbackRate === 'number') {
            list.push('PlaybackRate');
        }

        list.push('SetBrightness');
        list.push('SetAspectRatio');

        return list;
    }

    HtmlVideoPlayer.prototype.supports = function (feature) {
        if (!supportedFeatures) {
            supportedFeatures = getSupportedFeatures();
        }

        return supportedFeatures.indexOf(feature) !== -1;
    };

    // Save this for when playback stops, because querying the time at that point might return 0
    HtmlVideoPlayer.prototype.currentTime = function (val) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            if (val != null) {
                mediaElement.currentTime = val / 1000;
                return;
            }

            const currentTime = this._currentTime;
            if (currentTime) {
                return currentTime * 1000;
            }

            return (mediaElement.currentTime || 0) * 1000;
        }
    };

    HtmlVideoPlayer.prototype.duration = function (val) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            const duration = mediaElement.duration;
            if (htmlMediaHelper.isValidDuration(duration)) {
                return duration * 1000;
            }
        }

        return null;
    };

    HtmlVideoPlayer.prototype.canSetAudioStreamIndex = function (index) {
        if (browser.tizen || browser.orsay) {
            return true;
        }

        const video = this._mediaElement;
        if (video) {
            if (video.audioTracks) {
                return true;
            }
        }

        return false;
    };

    function onPictureInPictureError(err) {
        console.error('Picture in picture error: ' + err.toString());
    }

    HtmlVideoPlayer.prototype.setPictureInPictureEnabled = function (isEnabled) {
        const video = this._mediaElement;

        if (document.pictureInPictureEnabled) {
            if (video) {
                if (isEnabled) {
                    video.requestPictureInPicture().catch(onPictureInPictureError);
                } else {
                    document.exitPictureInPicture().catch(onPictureInPictureError);
                }
            }
        } else if (window.Windows) {
            this.isPip = isEnabled;
            if (isEnabled) {
                Windows.UI.ViewManagement.ApplicationView.getForCurrentView().tryEnterViewModeAsync(Windows.UI.ViewManagement.ApplicationViewMode.compactOverlay);
            } else {
                Windows.UI.ViewManagement.ApplicationView.getForCurrentView().tryEnterViewModeAsync(Windows.UI.ViewManagement.ApplicationViewMode.default);
            }
        } else {
            if (video && video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === 'function') {
                video.webkitSetPresentationMode(isEnabled ? 'picture-in-picture' : 'inline');
            }
        }
    };

    HtmlVideoPlayer.prototype.isPictureInPictureEnabled = function () {
        if (document.pictureInPictureEnabled) {
            return document.pictureInPictureElement ? true : false;
        } else if (window.Windows) {
            return this.isPip || false;
        } else {
            const video = this._mediaElement;
            if (video) {
                return video.webkitPresentationMode === 'picture-in-picture';
            }
        }

        return false;
    };

    HtmlVideoPlayer.prototype.isAirPlayEnabled = function () {
        if (document.AirPlayEnabled) {
            return document.AirplayElement ? true : false;
        }

        return false;
    };

    HtmlVideoPlayer.prototype.setAirPlayEnabled = function (isEnabled) {
        const video = this._mediaElement;

        if (document.AirPlayEnabled) {
            if (video) {
                if (isEnabled) {
                    video.requestAirPlay().catch(function(err) {
                        console.error('Error requesting AirPlay', err);
                    });
                } else {
                    document.exitAirPLay().catch(function(err) {
                        console.error('Error exiting AirPlay', err);
                    });
                }
            }
        } else {
            video.webkitShowPlaybackTargetPicker();
        }
    };

    HtmlVideoPlayer.prototype.setBrightness = function (val) {
        const elem = this._mediaElement;

        if (elem) {
            val = Math.max(0, val);
            val = Math.min(100, val);

            let rawValue = val;
            rawValue = Math.max(20, rawValue);

            const cssValue = rawValue >= 100 ? 'none' : (rawValue / 100);
            elem.style['-webkit-filter'] = 'brightness(' + cssValue + ');';
            elem.style.filter = 'brightness(' + cssValue + ')';
            elem.brightnessValue = val;
            events.trigger(this, 'brightnesschange');
        }
    };

    HtmlVideoPlayer.prototype.getBrightness = function () {
        const elem = this._mediaElement;
        if (elem) {
            const val = elem.brightnessValue;
            return val == null ? 100 : val;
        }
    };

    HtmlVideoPlayer.prototype.seekable = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            const seekable = mediaElement.seekable;
            if (seekable && seekable.length) {
                let start = seekable.start(0);
                let end = seekable.end(0);

                if (!htmlMediaHelper.isValidDuration(start)) {
                    start = 0;
                }
                if (!htmlMediaHelper.isValidDuration(end)) {
                    end = 0;
                }

                return (end - start) > 0;
            }

            return false;
        }
    };

    HtmlVideoPlayer.prototype.pause = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.pause();
        }
    };

    // This is a retry after error
    HtmlVideoPlayer.prototype.resume = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.play();
        }
    };

    HtmlVideoPlayer.prototype.unpause = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.play();
        }
    };

    HtmlVideoPlayer.prototype.paused = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            return mediaElement.paused;
        }

        return false;
    };

    HtmlVideoPlayer.prototype.setPlaybackRate = function (value) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.playbackRate = value;
        }
    };

    HtmlVideoPlayer.prototype.getPlaybackRate = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            return mediaElement.playbackRate;
        }
        return null;
    };

    HtmlVideoPlayer.prototype.setVolume = function (val) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.volume = val / 100;
        }
    };

    HtmlVideoPlayer.prototype.getVolume = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            return Math.min(Math.round(mediaElement.volume * 100), 100);
        }
    };

    HtmlVideoPlayer.prototype.volumeUp = function () {
        this.setVolume(Math.min(this.getVolume() + 2, 100));
    };

    HtmlVideoPlayer.prototype.volumeDown = function () {
        this.setVolume(Math.max(this.getVolume() - 2, 0));
    };

    HtmlVideoPlayer.prototype.setMute = function (mute) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            mediaElement.muted = mute;
        }
    };

    HtmlVideoPlayer.prototype.isMuted = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            return mediaElement.muted;
        }
        return false;
    };

    HtmlVideoPlayer.prototype.setAspectRatio = function (val) {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            if ('auto' === val) {
                mediaElement.style.removeProperty('object-fit');
            } else {
                mediaElement.style['object-fit'] = val;
            }
        }
        this._currentAspectRatio = val;
    };

    HtmlVideoPlayer.prototype.getAspectRatio = function () {
        return this._currentAspectRatio || 'auto';
    };

    HtmlVideoPlayer.prototype.getSupportedAspectRatios = function () {
        return [{
            name: 'Auto',
            id: 'auto'
        }, {
            name: 'Cover',
            id: 'cover'
        }, {
            name: 'Fill',
            id: 'fill'
        }];
    };

    HtmlVideoPlayer.prototype.togglePictureInPicture = function () {
        return this.setPictureInPictureEnabled(!this.isPictureInPictureEnabled());
    };

    HtmlVideoPlayer.prototype.toggleAirPlay = function () {
        return this.setAirPlayEnabled(!this.isAirPlayEnabled());
    };

    HtmlVideoPlayer.prototype.getBufferedRanges = function () {
        const mediaElement = this._mediaElement;
        if (mediaElement) {
            return htmlMediaHelper.getBufferedRanges(this, mediaElement);
        }

        return [];
    };

    HtmlVideoPlayer.prototype.getStats = function () {
        const mediaElement = this._mediaElement;
        const playOptions = this._currentPlayOptions || [];

        const categories = [];

        if (!mediaElement) {
            return Promise.resolve({
                categories: categories
            });
        }

        const mediaCategory = {
            stats: [],
            type: 'media'
        };
        categories.push(mediaCategory);

        if (playOptions.url) {
            //  create an anchor element (note: no need to append this element to the document)
            let link = document.createElement('a');
            //  set href to any path
            link.setAttribute('href', playOptions.url);
            const protocol = (link.protocol || '').replace(':', '');

            if (protocol) {
                mediaCategory.stats.push({
                    label: globalize.translate('LabelProtocol'),
                    value: protocol
                });
            }

            link = null;
        }

        if (this._hlsPlayer) {
            mediaCategory.stats.push({
                label: globalize.translate('LabelStreamType'),
                value: 'HLS'
            });
        } else {
            mediaCategory.stats.push({
                label: globalize.translate('LabelStreamType'),
                value: 'Video'
            });
        }

        const videoCategory = {
            stats: [],
            type: 'video'
        };
        categories.push(videoCategory);

        const rect = mediaElement.getBoundingClientRect ? mediaElement.getBoundingClientRect() : {};
        let height = parseInt(rect.height);
        let width = parseInt(rect.width);

        // Don't show player dimensions on smart TVs because the app UI could be lower resolution than the video and this causes users to think there is a problem
        if (width && height && !browser.tv) {
            videoCategory.stats.push({
                label: globalize.translate('LabelPlayerDimensions'),
                value: width + 'x' + height
            });
        }

        height = mediaElement.videoHeight;
        width = mediaElement.videoWidth;

        if (width && height) {
            videoCategory.stats.push({
                label: globalize.translate('LabelVideoResolution'),
                value: width + 'x' + height
            });
        }

        if (mediaElement.getVideoPlaybackQuality) {
            const playbackQuality = mediaElement.getVideoPlaybackQuality();

            const droppedVideoFrames = playbackQuality.droppedVideoFrames || 0;
            videoCategory.stats.push({
                label: globalize.translate('LabelDroppedFrames'),
                value: droppedVideoFrames
            });

            const corruptedVideoFrames = playbackQuality.corruptedVideoFrames || 0;
            videoCategory.stats.push({
                label: globalize.translate('LabelCorruptedFrames'),
                value: corruptedVideoFrames
            });
        }

        const audioCategory = {
            stats: [],
            type: 'audio'
        };
        categories.push(audioCategory);

        const sinkId = mediaElement.sinkId;
        if (sinkId) {
            audioCategory.stats.push({
                label: 'Sink Id:',
                value: sinkId
            });
        }

        return Promise.resolve({
            categories: categories
        });
    };

    return HtmlVideoPlayer;
});
