define(['browser'], function (browser) {
    'use strict';

    function canPlayH264(videoTestElement) {
        return !!(videoTestElement.canPlayType && videoTestElement.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"').replace(/no/, ''));
    }

    function canPlayH265(videoTestElement, options) {
        if (browser.tizen || browser.xboxOne || browser.web0s || options.supportsHevc) {
            return true;
        }

        if (browser.ps4) {
            return false;
        }

        return !!videoTestElement.canPlayType &&
        (videoTestElement.canPlayType('video/mp4; codecs="hvc1.1.L120"').replace(/no/, '') ||
        videoTestElement.canPlayType('video/mp4; codecs="hev1.1.L120"').replace(/no/, '') ||
        videoTestElement.canPlayType('video/mp4; codecs="hvc1.1.0.L120"').replace(/no/, '') ||
        videoTestElement.canPlayType('video/mp4; codecs="hev1.1.0.L120"').replace(/no/, ''));
    }

    let _supportsTextTracks;
    function supportsTextTracks() {
        if (browser.tizen) {
            return true;
        }

        if (_supportsTextTracks == null) {
            _supportsTextTracks = document.createElement('video').textTracks != null;
        }

        // For now, until ready
        return _supportsTextTracks;
    }

    let _canPlayHls;
    function canPlayHls() {
        if (_canPlayHls == null) {
            _canPlayHls = canPlayNativeHls() || canPlayHlsWithMSE();
        }

        return _canPlayHls;
    }

    function canPlayNativeHls() {
        if (browser.tizen) {
            return true;
        }

        const media = document.createElement('video');
        if (media.canPlayType('application/x-mpegURL').replace(/no/, '') ||
            media.canPlayType('application/vnd.apple.mpegURL').replace(/no/, '')) {
            return true;
        }

        return false;
    }

    function canPlayHlsWithMSE() {
        // text tracks don’t work with this in firefox
        return window.MediaSource != null; /* eslint-disable-line compat/compat */
    }

    function supportsAc3(videoTestElement) {
        if (browser.edgeUwp || browser.tizen || browser.web0s) {
            return true;
        }

        return videoTestElement.canPlayType('audio/mp4; codecs="ac-3"').replace(/no/, '');
    }

    function supportsEac3(videoTestElement) {
        if (browser.tizen || browser.web0s) {
            return true;
        }

        return videoTestElement.canPlayType('audio/mp4; codecs="ec-3"').replace(/no/, '');
    }

    function supportsAc3InHls(videoTestElement) {
        if (browser.tizen || browser.web0s) {
            return true;
        }

        if (videoTestElement.canPlayType) {
            return videoTestElement.canPlayType('application/x-mpegurl; codecs="avc1.42E01E, ac-3"').replace(/no/, '') ||
                videoTestElement.canPlayType('application/vnd.apple.mpegURL; codecs="avc1.42E01E, ac-3"').replace(/no/, '');
        }

        return false;
    }

    function canPlayAudioFormat(format) {
        let typeString;

        if (format === 'flac') {
            if (browser.tizen || browser.web0s || browser.edgeUwp) {
                return true;
            }
        } else if (format === 'wma') {
            if (browser.tizen || browser.edgeUwp) {
                return true;
            }
        } else if (format === 'asf') {
            if (browser.tizen || browser.web0s || browser.edgeUwp) {
                return true;
            }
        } else if (format === 'opus') {
            if (!browser.web0s) {
                typeString = 'audio/ogg; codecs="opus"';
                return !!document.createElement('audio').canPlayType(typeString).replace(/no/, '');
            }

            return false;
        } else if (format === 'alac') {
            if (browser.iOS || browser.osx) {
                return true;
            }
        } else if (format === 'mp2') {
            // For now
            return false;
        }

        if (format === 'webma') {
            typeString = 'audio/webm';
        } else if (format === 'mp2') {
            typeString = 'audio/mpeg';
        } else {
            typeString = 'audio/' + format;
        }

        return !!document.createElement('audio').canPlayType(typeString).replace(/no/, '');
    }

    function testCanPlayMkv(videoTestElement) {
        if (browser.tizen || browser.web0s) {
            return true;
        }

        if (videoTestElement.canPlayType('video/x-matroska').replace(/no/, '') ||
            videoTestElement.canPlayType('video/mkv').replace(/no/, '')) {
            return true;
        }

        if (browser.edgeChromium && browser.windows) {
            return true;
        }

        if (browser.edgeUwp) {
            return true;
        }

        return false;
    }

    function testCanPlayAv1(videoTestElement) {
        if (browser.tizenVersion >= 5.5) {
            return true;
        } else if (browser.web0sVersion >= 5 && window.outerHeight >= 2160) {
            return true;
        }

        return videoTestElement.canPlayType('video/webm; codecs="av01.0.15M.10"').replace(/no/, '');
    }

    function testCanPlayTs() {
        return browser.tizen || browser.web0s || browser.edgeUwp;
    }

    function supportsMpeg2Video() {
        return browser.tizen || browser.web0s || browser.edgeUwp;
    }

    function supportsVc1(videoTestElement) {
        return browser.tizen || browser.web0s || browser.edgeUwp || videoTestElement.canPlayType('video/mp4; codecs="vc-1"').replace(/no/, '');
    }

    function getDirectPlayProfileForVideoContainer(container, videoAudioCodecs, videoTestElement, options) {
        let supported = false;
        let profileContainer = container;
        const videoCodecs = [];

        switch (container) {
            case 'asf':
                supported = browser.tizen || browser.web0s || browser.edgeUwp;
                videoAudioCodecs = [];
                break;
            case 'avi':
                supported = browser.tizen || browser.web0s || browser.edgeUwp;
                // New Samsung TV don't support XviD/DivX
                // Explicitly add supported codecs to make other codecs be transcoded
                if (browser.tizenVersion >= 4) {
                    videoCodecs.push('h264');
                    if (canPlayH265(videoTestElement, options)) {
                        videoCodecs.push('h265');
                        videoCodecs.push('hevc');
                    }
                }
                break;
            case 'mpg':
            case 'mpeg':
                supported = browser.tizen || browser.web0s || browser.edgeUwp;
                break;
            case 'flv':
                supported = browser.tizen;
                break;
            case '3gp':
            case 'mts':
            case 'trp':
            case 'vob':
            case 'vro':
                supported = browser.tizen;
                break;
            case 'mov':
                supported = browser.tizen || browser.web0s || browser.chrome || browser.edgeChromium || browser.edgeUwp;
                videoCodecs.push('h264');
                break;
            case 'm2ts':
                supported = browser.tizen || browser.web0s || browser.edgeUwp;
                videoCodecs.push('h264');
                if (supportsVc1(videoTestElement)) {
                    videoCodecs.push('vc1');
                }
                if (supportsMpeg2Video()) {
                    videoCodecs.push('mpeg2video');
                }
                break;
            case 'wmv':
                supported = browser.tizen || browser.web0s || browser.edgeUwp;
                videoAudioCodecs = [];
                break;
            case 'ts':
                supported = testCanPlayTs();
                videoCodecs.push('h264');
                if (canPlayH265(videoTestElement, options)) {
                    videoCodecs.push('h265');
                    videoCodecs.push('hevc');
                }
                if (supportsVc1(videoTestElement)) {
                    videoCodecs.push('vc1');
                }
                if (supportsMpeg2Video()) {
                    videoCodecs.push('mpeg2video');
                }
                profileContainer = 'ts,mpegts';
                break;
            default:
                break;
        }

        return supported ? {
            Container: profileContainer,
            Type: 'Video',
            VideoCodec: videoCodecs.join(','),
            AudioCodec: videoAudioCodecs.join(',')
        } : null;
    }

    function getMaxBitrate() {
        return 120000000;
    }

    function getGlobalMaxVideoBitrate() {
        let isTizenFhd = false;
        if (browser.tizen) {
            try {
                const isTizenUhd = webapis.productinfo.isUdPanelSupported();
                isTizenFhd = !isTizenUhd;
                console.debug('isTizenFhd = ' + isTizenFhd);
            } catch (error) {
                console.error('isUdPanelSupported() error code = ' + error.code);
            }
        }

        return browser.ps4 ? 8000000 :
            (browser.xboxOne ? 12000000 :
                (browser.edgeUwp ? null :
                    (browser.tizen && isTizenFhd ? 20000000 : null)));
    }

    return function (options) {
        options = options || {};

        const physicalAudioChannels = options.audioChannels || (browser.tv || browser.ps4 || browser.xboxOne ? 6 : 2);

        const bitrateSetting = getMaxBitrate();

        const videoTestElement = document.createElement('video');

        const canPlayVp8 = videoTestElement.canPlayType('video/webm; codecs="vp8"').replace(/no/, '');
        const canPlayVp9 = videoTestElement.canPlayType('video/webm; codecs="vp9"').replace(/no/, '');
        const webmAudioCodecs = ['vorbis'];

        const canPlayMkv = testCanPlayMkv(videoTestElement);

        const profile = {};

        profile.MaxStreamingBitrate = bitrateSetting;
        profile.MaxStaticBitrate = 100000000;
        profile.MusicStreamingTranscodingBitrate = Math.min(bitrateSetting, 192000);

        profile.DirectPlayProfiles = [];

        let videoAudioCodecs = [];
        let hlsVideoAudioCodecs = [];

        const supportsMp3VideoAudio = videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.69"').replace(/no/, '')
                                    || videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.6B"').replace(/no/, '')
                                    || videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp3"').replace(/no/, '');

        // Not sure how to test for this
        const supportsMp2VideoAudio = browser.edgeUwp || browser.tizen || browser.web0s;

        let maxVideoWidth = browser.xboxOne ?
            (self.screen ? self.screen.width : null) :
            null;

        if (options.maxVideoWidth) {
            maxVideoWidth = options.maxVideoWidth;
        }

        const canPlayAacVideoAudio = videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.2"').replace(/no/, '');

        // Only put mp3 first if mkv support is there
        // Otherwise with HLS and mp3 audio we're seeing some browsers
        // safari is lying
        if (supportsAc3(videoTestElement)) {
            videoAudioCodecs.push('ac3');

            const eAc3 = supportsEac3(videoTestElement);
            if (eAc3) {
                videoAudioCodecs.push('eac3');
            }

            // This works in edge desktop, but not mobile
            // TODO: Retest this on mobile
            if (supportsAc3InHls(videoTestElement)) {
                hlsVideoAudioCodecs.push('ac3');
                if (eAc3) {
                    hlsVideoAudioCodecs.push('eac3');
                }
            }
        }

        if (supportsMp3VideoAudio) {
            videoAudioCodecs.push('mp3');

            // PS4 fails to load HLS with mp3 audio
            if (!browser.ps4) {
                // mp3 encoder only supports 2 channels, so only make that preferred if we're only requesting 2 channels
                // Also apply it for chromecast because it no longer supports AAC 5.1
                if (physicalAudioChannels <= 2) {
                    hlsVideoAudioCodecs.push('mp3');
                }
            }
        }

        if (canPlayAacVideoAudio) {
            if (videoAudioCodecs.indexOf('aac') === -1) {
                videoAudioCodecs.push('aac');
            }

            hlsVideoAudioCodecs.push('aac');
        }

        if (supportsMp3VideoAudio) {
            // PS4 fails to load HLS with mp3 audio
            if (!browser.ps4) {
                if (hlsVideoAudioCodecs.indexOf('mp3') === -1) {
                    hlsVideoAudioCodecs.push('mp3');
                }
            }
        }

        if (supportsMp2VideoAudio) {
            videoAudioCodecs.push('mp2');
        }

        let supportsDts = browser.tizen || browser.web0s || options.supportsDts || videoTestElement.canPlayType('video/mp4; codecs="dts-"').replace(/no/, '') || videoTestElement.canPlayType('video/mp4; codecs="dts+"').replace(/no/, '');

        // DTS audio not supported in 2018 models (Tizen 4.0)
        if (browser.tizenVersion >= 4) {
            supportsDts = false;
        }

        if (supportsDts) {
            videoAudioCodecs.push('dca');
            videoAudioCodecs.push('dts');
        }

        if (browser.tizen || browser.web0s) {
            videoAudioCodecs.push('pcm_s16le');
            videoAudioCodecs.push('pcm_s24le');
        }

        if (options.supportsTrueHd) {
            videoAudioCodecs.push('truehd');
        }

        if (browser.tizen) {
            videoAudioCodecs.push('aac_latm');
        }

        if (canPlayAudioFormat('opus')) {
            videoAudioCodecs.push('opus');
            hlsVideoAudioCodecs.push('opus');
            webmAudioCodecs.push('opus');
        }

        if (canPlayAudioFormat('flac')) {
            videoAudioCodecs.push('flac');
        }

        videoAudioCodecs = videoAudioCodecs.filter(function (c) {
            return (options.disableVideoAudioCodecs || []).indexOf(c) === -1;
        });

        hlsVideoAudioCodecs = hlsVideoAudioCodecs.filter(function (c) {
            return (options.disableHlsVideoAudioCodecs || []).indexOf(c) === -1;
        });

        const mp4VideoCodecs = [];
        const webmVideoCodecs = [];
        const hlsVideoCodecs = [];

        if (canPlayH264(videoTestElement)) {
            mp4VideoCodecs.push('h264');
            hlsVideoCodecs.push('h264');
        }

        if (canPlayH265(videoTestElement, options)) {
            mp4VideoCodecs.push('h265');
            mp4VideoCodecs.push('hevc');

            if (browser.tizen || browser.web0s) {
                hlsVideoCodecs.push('h265');
                hlsVideoCodecs.push('hevc');
            }
        }

        if (supportsMpeg2Video()) {
            mp4VideoCodecs.push('mpeg2video');
        }

        if (supportsVc1(videoTestElement)) {
            mp4VideoCodecs.push('vc1');
        }

        if (browser.tizen) {
            mp4VideoCodecs.push('msmpeg4v2');
        }

        if (canPlayVp8) {
            mp4VideoCodecs.push('vp8');
            webmVideoCodecs.push('vp8');
        }

        if (canPlayVp9) {
            mp4VideoCodecs.push('vp9');
            webmVideoCodecs.push('vp9');
        }

        if (testCanPlayAv1(videoTestElement)) {
            mp4VideoCodecs.push('av1');
            webmVideoCodecs.push('av1');
        }

        if (canPlayVp8 || browser.tizen) {
            videoAudioCodecs.push('vorbis');
        }

        if (webmVideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'webm',
                Type: 'Video',
                VideoCodec: webmVideoCodecs.join(','),
                AudioCodec: webmAudioCodecs.join(',')
            });
        }

        if (mp4VideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'mp4,m4v',
                Type: 'Video',
                VideoCodec: mp4VideoCodecs.join(','),
                AudioCodec: videoAudioCodecs.join(',')
            });
        }

        if (canPlayMkv && mp4VideoCodecs.length) {
            profile.DirectPlayProfiles.push({
                Container: 'mkv',
                Type: 'Video',
                VideoCodec: mp4VideoCodecs.join(','),
                AudioCodec: videoAudioCodecs.join(',')
            });
        }

        // These are formats we can't test for but some devices will support
        ['m2ts', 'wmv', 'ts', 'asf', 'avi', 'mpg', 'mpeg', 'flv', '3gp', 'mts', 'trp', 'vob', 'vro', 'mov'].map(function (container) {
            return getDirectPlayProfileForVideoContainer(container, videoAudioCodecs, videoTestElement, options);
        }).filter(function (i) {
            return i != null;
        }).forEach(function (i) {
            profile.DirectPlayProfiles.push(i);
        });

        ['opus', 'mp3', 'mp2', 'aac', 'flac', 'alac', 'webma', 'wma', 'wav', 'ogg', 'oga'].filter(canPlayAudioFormat).forEach(function (audioFormat) {
            if (audioFormat === 'mp2') {
                profile.DirectPlayProfiles.push({
                    Container: 'mp2,mp3',
                    Type: 'Audio',
                    AudioCodec: audioFormat
                });
            } else if (audioFormat === 'mp3') {
                profile.DirectPlayProfiles.push({
                    Container: audioFormat,
                    Type: 'Audio',
                    AudioCodec: audioFormat
                });
            } else {
                profile.DirectPlayProfiles.push({
                    Container: audioFormat === 'webma' ? 'webma,webm' : audioFormat,
                    Type: 'Audio'
                });
            }

            // aac also appears in the m4a and m4b container
            if (audioFormat === 'aac' || audioFormat === 'alac') {
                profile.DirectPlayProfiles.push({
                    Container: 'm4a,m4b',
                    AudioCodec: audioFormat,
                    Type: 'Audio'
                });
            }
        });

        profile.TranscodingProfiles = [];

        const hlsBreakOnNonKeyFrames = browser.iOS || browser.osx || browser.edge || !canPlayNativeHls() ? true : false;

        if (canPlayHls() && browser.enableHlsAudio !== false) {
            profile.TranscodingProfiles.push({
                // hlsjs, edge, and android all seem to require ts container
                Container: !canPlayNativeHls() || browser.edge || browser.android ? 'ts' : 'aac',
                Type: 'Audio',
                AudioCodec: 'aac',
                Context: 'Streaming',
                Protocol: 'hls',
                MaxAudioChannels: physicalAudioChannels.toString(),
                MinSegments: browser.iOS || browser.osx ? '2' : '1',
                BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames
            });
        }

        // For streaming, prioritize opus transcoding after mp3/aac. It is too problematic with random failures
        // But for static (offline sync), it will be just fine.
        // Prioritize aac higher because the encoder can accept more channels than mp3
        ['aac', 'mp3', 'opus', 'wav'].filter(canPlayAudioFormat).forEach(function (audioFormat) {
            profile.TranscodingProfiles.push({
                Container: audioFormat,
                Type: 'Audio',
                AudioCodec: audioFormat,
                Context: 'Streaming',
                Protocol: 'http',
                MaxAudioChannels: physicalAudioChannels.toString()
            });
        });

        ['opus', 'mp3', 'aac', 'wav'].filter(canPlayAudioFormat).forEach(function (audioFormat) {
            profile.TranscodingProfiles.push({
                Container: audioFormat,
                Type: 'Audio',
                AudioCodec: audioFormat,
                Context: 'Static',
                Protocol: 'http',
                MaxAudioChannels: physicalAudioChannels.toString()
            });
        });

        if (canPlayMkv && !browser.tizen && options.enableMkvProgressive !== false) {
            profile.TranscodingProfiles.push({
                Container: 'mkv',
                Type: 'Video',
                AudioCodec: videoAudioCodecs.join(','),
                VideoCodec: mp4VideoCodecs.join(','),
                Context: 'Streaming',
                MaxAudioChannels: physicalAudioChannels.toString(),
                CopyTimestamps: true
            });
        }

        if (canPlayMkv) {
            profile.TranscodingProfiles.push({
                Container: 'mkv',
                Type: 'Video',
                AudioCodec: videoAudioCodecs.join(','),
                VideoCodec: mp4VideoCodecs.join(','),
                Context: 'Static',
                MaxAudioChannels: physicalAudioChannels.toString(),
                CopyTimestamps: true
            });
        }

        if (canPlayHls() && hlsVideoAudioCodecs.length && options.enableHls !== false) {
            profile.TranscodingProfiles.push({
                Container: 'ts',
                Type: 'Video',
                AudioCodec: hlsVideoAudioCodecs.join(','),
                VideoCodec: hlsVideoCodecs.join(','),
                Context: 'Streaming',
                Protocol: 'hls',
                MaxAudioChannels: physicalAudioChannels.toString(),
                MinSegments: browser.iOS || browser.osx ? '2' : '1',
                BreakOnNonKeyFrames: hlsBreakOnNonKeyFrames
            });
        }

        if (canPlayVp8) {
            profile.TranscodingProfiles.push({
                Container: 'webm',
                Type: 'Video',
                AudioCodec: 'vorbis',
                VideoCodec: 'vpx',
                Context: 'Streaming',
                Protocol: 'http',
                // If audio transcoding is needed, limit channels to number of physical audio channels
                // Trying to transcode to 5 channels when there are only 2 speakers generally does not sound good
                MaxAudioChannels: physicalAudioChannels.toString()
            });
        }

        profile.TranscodingProfiles.push({
            Container: 'mp4',
            Type: 'Video',
            AudioCodec: videoAudioCodecs.join(','),
            VideoCodec: 'h264',
            Context: 'Static',
            Protocol: 'http'
        });

        profile.ContainerProfiles = [];

        profile.CodecProfiles = [];

        const supportsSecondaryAudio = browser.tizen || videoTestElement.audioTracks;

        const aacCodecProfileConditions = [];

        // Handle he-aac not supported
        if (!videoTestElement.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.5"').replace(/no/, '')) {
            // TODO: This needs to become part of the stream url in order to prevent stream copy
            aacCodecProfileConditions.push({
                Condition: 'NotEquals',
                Property: 'AudioProfile',
                Value: 'HE-AAC'
            });
        }

        if (!supportsSecondaryAudio) {
            aacCodecProfileConditions.push({
                Condition: 'Equals',
                Property: 'IsSecondaryAudio',
                Value: 'false',
                IsRequired: false
            });
        }

        if (aacCodecProfileConditions.length) {
            profile.CodecProfiles.push({
                Type: 'VideoAudio',
                Codec: 'aac',
                Conditions: aacCodecProfileConditions
            });
        }

        if (!supportsSecondaryAudio) {
            profile.CodecProfiles.push({
                Type: 'VideoAudio',
                Conditions: [
                    {
                        Condition: 'Equals',
                        Property: 'IsSecondaryAudio',
                        Value: 'false',
                        IsRequired: false
                    }
                ]
            });
        }

        let maxH264Level = 42;
        let h264Profiles = 'high|main|baseline|constrained baseline';

        if (browser.tizen || browser.web0s ||
            videoTestElement.canPlayType('video/mp4; codecs="avc1.640833"').replace(/no/, '')) {
            maxH264Level = 51;
        }

        // Support H264 Level 52 (Tizen 5.0) - app only
        if (browser.tizenVersion >= 5 && window.NativeShell) {
            maxH264Level = 52;
        }

        if (browser.tizen ||
            videoTestElement.canPlayType('video/mp4; codecs="avc1.6e0033"').replace(/no/, '')) {
            // These tests are passing in safari, but playback is failing
            if (!browser.safari && !browser.iOS && !browser.web0s && !browser.edge && !browser.mobile) {
                h264Profiles += '|high 10';
            }
        }

        const h264CodecProfileConditions = [
            {
                Condition: 'NotEquals',
                Property: 'IsAnamorphic',
                Value: 'true',
                IsRequired: false
            },
            {
                Condition: 'EqualsAny',
                Property: 'VideoProfile',
                Value: h264Profiles,
                IsRequired: false
            },
            {
                Condition: 'LessThanEqual',
                Property: 'VideoLevel',
                Value: maxH264Level.toString(),
                IsRequired: false
            }
        ];

        if (!browser.edgeUwp && !browser.tizen && !browser.web0s) {
            h264CodecProfileConditions.push({
                Condition: 'NotEquals',
                Property: 'IsInterlaced',
                Value: 'true',
                IsRequired: false
            });
        }

        if (maxVideoWidth) {
            h264CodecProfileConditions.push({
                Condition: 'LessThanEqual',
                Property: 'Width',
                Value: maxVideoWidth.toString(),
                IsRequired: false
            });
        }

        const globalMaxVideoBitrate = (getGlobalMaxVideoBitrate() || '').toString();

        const h264MaxVideoBitrate = globalMaxVideoBitrate;

        if (h264MaxVideoBitrate) {
            h264CodecProfileConditions.push({
                Condition: 'LessThanEqual',
                Property: 'VideoBitrate',
                Value: h264MaxVideoBitrate,
                IsRequired: true
            });
        }

        // On iOS 12.x, for TS container max h264 level is 4.2
        if (browser.iOS && browser.iOSVersion < 13) {
            const codecProfile = {
                Type: 'Video',
                Codec: 'h264',
                Container: 'ts',
                Conditions: h264CodecProfileConditions.filter((condition) => {
                    return condition.Property !== 'VideoLevel';
                })
            };

            codecProfile.Conditions.push({
                Condition: 'LessThanEqual',
                Property: 'VideoLevel',
                Value: '42',
                IsRequired: false
            });

            profile.CodecProfiles.push(codecProfile);
        }

        profile.CodecProfiles.push({
            Type: 'Video',
            Codec: 'h264',
            Conditions: h264CodecProfileConditions
        });

        const globalVideoConditions = [];

        if (globalMaxVideoBitrate) {
            globalVideoConditions.push({
                Condition: 'LessThanEqual',
                Property: 'VideoBitrate',
                Value: globalMaxVideoBitrate
            });
        }

        if (maxVideoWidth) {
            globalVideoConditions.push({
                Condition: 'LessThanEqual',
                Property: 'Width',
                Value: maxVideoWidth.toString(),
                IsRequired: false
            });
        }

        if (globalVideoConditions.length) {
            profile.CodecProfiles.push({
                Type: 'Video',
                Conditions: globalVideoConditions
            });
        }

        // Subtitle profiles
        // External vtt or burn in
        profile.SubtitleProfiles = [];
        if (supportsTextTracks()) {
            profile.SubtitleProfiles.push({
                Format: 'vtt',
                Method: 'External'
            });
        }
        if (options.enableSsaRender) {
            profile.SubtitleProfiles.push({
                Format: 'ass',
                Method: 'External'
            });
            profile.SubtitleProfiles.push({
                Format: 'ssa',
                Method: 'External'
            });
        }

        profile.ResponseProfiles = [];
        profile.ResponseProfiles.push({
            Type: 'Video',
            Container: 'm4v',
            MimeType: 'video/mp4'
        });

        return profile;
    };
});
