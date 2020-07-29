define(['jQuery', 'loading', 'globalize', 'emby-button'], function ($, loading, globalize) {
    'use strict';

    function loadPage(page, config) {
        $('.liveTvSettingsForm', page).show();
        $('.noLiveTvServices', page).hide();
        $('#selectGuideDays', page).val(config.GuideDays || '');
        $('#txtPrePaddingMinutes', page).val(config.PrePaddingSeconds / 60);
        $('#txtPostPaddingMinutes', page).val(config.PostPaddingSeconds / 60);
        page.querySelector('#txtRecordingPath').value = config.RecordingPath || '';
        page.querySelector('#txtMovieRecordingPath').value = config.MovieRecordingPath || '';
        page.querySelector('#txtSeriesRecordingPath').value = config.SeriesRecordingPath || '';
        page.querySelector('#txtPostProcessor').value = config.RecordingPostProcessor || '';
        page.querySelector('#txtPostProcessorArguments').value = config.RecordingPostProcessorArguments || '';
        loading.hide();
    }

    function onSubmit() {
        loading.show();
        const form = this;
        ApiClient.getNamedConfiguration('livetv').then(function (config) {
            config.GuideDays = $('#selectGuideDays', form).val() || null;
            const recordingPath = form.querySelector('#txtRecordingPath').value || null;
            const movieRecordingPath = form.querySelector('#txtMovieRecordingPath').value || null;
            const seriesRecordingPath = form.querySelector('#txtSeriesRecordingPath').value || null;
            const recordingPathChanged = recordingPath != config.RecordingPath || movieRecordingPath != config.MovieRecordingPath || seriesRecordingPath != config.SeriesRecordingPath;
            config.RecordingPath = recordingPath;
            config.MovieRecordingPath = movieRecordingPath;
            config.SeriesRecordingPath = seriesRecordingPath;
            config.RecordingEncodingFormat = 'mkv';
            config.PrePaddingSeconds = 60 * $('#txtPrePaddingMinutes', form).val();
            config.PostPaddingSeconds = 60 * $('#txtPostPaddingMinutes', form).val();
            config.RecordingPostProcessor = $('#txtPostProcessor', form).val();
            config.RecordingPostProcessorArguments = $('#txtPostProcessorArguments', form).val();
            ApiClient.updateNamedConfiguration('livetv', config).then(function () {
                Dashboard.processServerConfigurationUpdateResult();
                showSaveMessage(recordingPathChanged);
            });
        });
        return false;
    }

    function showSaveMessage(recordingPathChanged) {
        let msg = '';

        if (recordingPathChanged) {
            msg += globalize.translate('RecordingPathChangeMessage');
        }

        if (msg) {
            require(['alert'], function (alert) {
                alert(msg);
            });
        }
    }

    $(document).on('pageinit', '#liveTvSettingsPage', function () {
        const page = this;
        $('.liveTvSettingsForm').off('submit', onSubmit).on('submit', onSubmit);
        $('#btnSelectRecordingPath', page).on('click.selectDirectory', function () {
            require(['directorybrowser'], function (directoryBrowser) {
                const picker = new directoryBrowser.default();
                picker.show({
                    callback: function (path) {
                        if (path) {
                            $('#txtRecordingPath', page).val(path);
                        }

                        picker.close();
                    },
                    validateWriteable: true
                });
            });
        });
        $('#btnSelectMovieRecordingPath', page).on('click.selectDirectory', function () {
            require(['directorybrowser'], function (directoryBrowser) {
                const picker = new directoryBrowser.default();
                picker.show({
                    callback: function (path) {
                        if (path) {
                            $('#txtMovieRecordingPath', page).val(path);
                        }

                        picker.close();
                    },
                    validateWriteable: true
                });
            });
        });
        $('#btnSelectSeriesRecordingPath', page).on('click.selectDirectory', function () {
            require(['directorybrowser'], function (directoryBrowser) {
                const picker = new directoryBrowser.default();
                picker.show({
                    callback: function (path) {
                        if (path) {
                            $('#txtSeriesRecordingPath', page).val(path);
                        }

                        picker.close();
                    },
                    validateWriteable: true
                });
            });
        });
        $('#btnSelectPostProcessorPath', page).on('click.selectDirectory', function () {
            require(['directorybrowser'], function (directoryBrowser) {
                const picker = new directoryBrowser.default();
                picker.show({
                    includeFiles: true,
                    callback: function (path) {
                        if (path) {
                            $('#txtPostProcessor', page).val(path);
                        }

                        picker.close();
                    }
                });
            });
        });
    }).on('pageshow', '#liveTvSettingsPage', function () {
        loading.show();
        const page = this;
        ApiClient.getNamedConfiguration('livetv').then(function (config) {
            loadPage(page, config);
        });
    });
});
