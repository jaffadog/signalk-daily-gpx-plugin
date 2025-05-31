[![npm version](https://img.shields.io/npm/v/signalk-daily-gpx-plugin.svg)](https://www.npmjs.com/package/signalk-daily-gpx-plugin)

# SignalK Daily GPX Plugin

A [SignalK](https://signalk.org/) plugin that generates a daily [GPX](http://www.topografix.com/gpx.asp) file.

## What Does It Do?

The SignalK Daily GPX Plugin records your position on a specified time interval to a temporary buffer on the SignalK server. At midnight, it collects the recorded data and creates a GPX file containing your track for the day. The GPX file is saved on the SignalK server in a folder of your choosing. Over time, you automatically accumulate daily GPX track files documenting your voyages.

Note that GPX files are not created until midnight (per the clock on your SignalK server). So if you look for GPX files before then, you won't find any.

## Configuration

### GPS Position Source

If there are multiple sources of **navigation.position**, then specify which one we should use. If left blank, all will be used - which may lead to duplicate points in the track, or less time than the specified interval between points. If you have multiple sources of **navigation.position** being reported in SignalK, you should configure **Source Priorities** in SignalK to filter out the duplicate/extraneous source(s).

### Time Interval

Number of minutes between recorded track points (default is 10 minutes).

### Minimum Move Distance (meters)

The minimum boat movement in the specified time interval required before recording a track point. This prevents track recording while anchored or docked. If blank, the track is recorded regardless of movement. (default is 50 meters)

### Folder Path

Folder path to save GPX files in. If left blank, default is:

    $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/signalk-daily-gpx-plugin.

## Extras

This plugin includes a SignalK webapp (also named **SignalK Daily GPX Plugin**) which facilitates downloading GPX files and managing the local buffer.

If your travels take you across timezones, you could use the [signalk-set-gps-timezone](https://github.com/hoeken/signalk-set-gps-timezone) plugin to automatically update your SignalK server's timezone. That way, GPX files will always be written at midnight in your local timezone - and capture the full day of travel with an ongoing local timezone context.
