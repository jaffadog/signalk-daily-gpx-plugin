# SignalK Daily GPX Plugin

[![npm version](https://img.shields.io/npm/v/signalk-daily-gpx-plugin.svg)](https://www.npmjs.com/package/signalk-daily-gpx-plugin)

A [SignalK](https://signalk.org/) plugin that generates a daily [GPX](http://www.topografix.com/gpx.asp) file

## Configuration

### GPS Position Source

If there are multiple sources of **navigation.position**, then specify which one we should use. If left blank, all will be used - which may lead to duplicate points, or less time that the specified interval between points. If you have multiple sources of **navigation.position** being reported in SignalK, you should configure **Source Priorities** in SignalK to filter out the duplicate/extraneous source(s).

### Time Interval

Number of minutes between recorded track points (default is 10 minutes)

### Folder Path

Folder path to save GPX files in. If left blank, default is:

    $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/signalk-daily-gpx-plugin.

## Behavior

The plugin will store track points in a local cache and will write the GPX file after midnight every day (per the signal K server clock) - so you will not find a GPX file until after midnight. 

If you want to force a GPX file to be written, use:

    http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/write-gpx-file-now. 

If you want to clear the local cache, use:

    http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/clear-buffer-now.
