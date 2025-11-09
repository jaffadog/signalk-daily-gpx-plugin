[![npm version](https://img.shields.io/npm/v/signalk-daily-gpx-plugin.svg)](https://www.npmjs.com/package/signalk-daily-gpx-plugin)

# SignalK Daily GPX Plugin

A [SignalK](https://signalk.org/) plugin that records your track and generates either daily or per-voyage [GPX](http://www.topografix.com/gpx.asp) files.

## What Does It Do?

The SignalK Daily GPX Plugin records your position on a specified time interval to a temporary buffer on the SignalK server. You can configure it to either create a daily GPX file - or per voyage. If configured to generate daily GPX files, at midnight, it collects the recorded data and creates a GPX file containing your track for the day. If configured to generate GPX files per-voyage, once the vessel stops, it collects the recorded data and creates a GPX file containing your track for that voyage. The GPX file is saved on the SignalK server in a folder of your choosing. Over time, you automatically accumulate GPX track files documenting your voyages.

| ![](/src/web/public/assets/screenshot-map.png) |
| ---------------------------------------------- |

| ![](/src/web/public/assets/screenshot-files.png) |
| ------------------------------------------------ |

## Configuration

### GPS Position Source

If there are multiple sources of **navigation.position**, then specify which one we should use. If left blank, all will be used - which may lead to duplicate points in the track, or less time than the specified interval between points. If you have multiple sources of **navigation.position** being reported in SignalK, you should configure **Source Priorities** in SignalK to filter out the duplicate/extraneous source(s).

### Time Interval (minutes)

Number of minutes between recorded track positions (default is 1 minutes).

### Minimum Speed (knots)

The minimum speed over ground (SOG) required to trigger track recording. This prevents track recording while anchored or docked. If set to 0, the track is recorded regardless of boat speed (default is 0.5 knots).

### Minimum Distance (meters)

The minimum distance between recorded track points. This prevents track recording while anchored or docked. If set to zero, the track is recorded regardless of distance between points (default is 50 meters).

### Track Simplification Tolerance (meters)

Simplify the saved track - by removing points where the track is pretty straight and keeping points where direction changes. This produces a much smaller GPX file while maintaining good path resolution. If set to 0, track simplification will be disabled and the track will be saved at the full recorded resolution (default is 10 meters).

### Folder Path

Folder path to save gpx files in. If left blank, default is:

    $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/signalk-daily-gpx-plugin.

### Record Voyage?

Create GPX files for each complete voyage rather than every 24 hours (default is false).

### Record Depth?

Record the current depth (from water surface) at each track point using the Garmin extension format (default is false).

## Extras

### Webapp

This plugin includes a SignalK webapp (also named **SignalK Daily GPX Plugin**) which facilitates viewing and downloading GPX files - and managing the local buffer.

### Recommended Plugins

If your travels take you across timezones, you could use the [signalk-set-gps-timezone](https://github.com/hoeken/signalk-set-gps-timezone) plugin to automatically update your SignalK server's timezone. That way, GPX files will always be written at midnight in your local timezone - and capture the full day of travel with an ongoing local timezone context.
