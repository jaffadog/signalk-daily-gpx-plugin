/*
 * signalk-daily-gpx-plugin
 * Jeremy Waters <jaffadog@gmail.com>"
 */

const GPX_LAT_LONG_DECIMAL_PLACES = 6;
const GPX_DEPTH_DECIMAL_PLACES = 2;
const KNOTS_PER_M_PER_S = 1.94384;
const MAX_DEPTH_AGE_IN_MILLIS = 10000;

const DEFAULT_TRACK_INTERVAL = 1;
const DEFAULT_MINIMUM_SPEED = 0.5;
const DEFAULT_MINIMUM_DISTANCE = 50;
const DEFAULT_RECORD_VOYAGE = false;
const DEFAULT_SIMPLIFICATION_TOLERANCE = 10;
const DEFAULT_RECORD_DEPTH = false;

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import simplify from "simplify-js";
import proj4 from "proj4";

export default function (app) {
  var plugin = {};
  var db;
  var lastRecordedPosition;
  var filename;
  var bufferCount = 0;
  var unsubscribes = [];

  var gpsSource;
  var trackInterval;
  var minimumSpeed;
  var minimumDistance;
  var recordVoyage;
  var simplificationTolerance;
  var recordDepth;
  var gpxFolder;

  plugin.id = "signalk-daily-gpx-plugin";
  plugin.name = "SignalK Daily GPX Plugin";
  plugin.description = "A SignalK plugin that writes a daily GPX file";

  plugin.start = function (options) {
    app.debug("Plugin started with options=", options);

    gpsSource = options.gpsSource;
    trackInterval = options.trackInterval || DEFAULT_TRACK_INTERVAL;
    minimumSpeed = options.minimumSpeed ?? DEFAULT_MINIMUM_SPEED; // ?? acccepts 0 as a valid value and wont overide it
    minimumDistance = options.minimumDistance ?? DEFAULT_MINIMUM_DISTANCE;
    recordVoyage = options.recordVoyage || DEFAULT_RECORD_VOYAGE;
    simplificationTolerance =
      options.simplificationTolerance ?? DEFAULT_SIMPLIFICATION_TOLERANCE;
    recordDepth = options.recordDepth ?? DEFAULT_RECORD_DEPTH;
    gpxFolder = options.gpxFolder ? options.gpxFolder : app.getDataDirPath();

    var dbFile = path.join(app.getDataDirPath(), plugin.id + ".sqlite3");
    db = new Database(dbFile, { verbose: app.debug });
    setupSchema();

    bufferCount = getBufferCount();

    var localSubscription = {
      context: "vessels.self",
      subscribe: [
        {
          path: "navigation.position",
          period: trackInterval * 60 * 1000,
        },
      ],
    };

    app.subscriptionmanager.subscribe(
      localSubscription,
      unsubscribes,
      (subscriptionError) => {
        app.error("Error:" + subscriptionError);
      },
      (delta) => processDelta(delta),
    );
  };

  plugin.stop = function () {
    app.debug(`Stopping the plugin`);
    unsubscribes.forEach((f) => f());
    unsubscribes = [];
    if (db) {
      app.debug("Closing db");
      try {
        db.close();
      } catch (err) {
        app.error("error closing db", err);
      }
    }
    db = null;
    app.debug("Stopped");
  };

  plugin.schema = {
    type: "object",
    description: `NOTE: The plugin will store track positions in a local buffer and will write the gpx file at 
        midnight (per the signal K server clock) - or at the completion of the voyage. You can review and download 
        available gpx files in the SignalK Daily GPX Plugin webapp.`,
    required: [
      "trackInterval",
      "minimumSpeed",
      "minimumDistance",
      "simplificationTolerance",
    ],
    properties: {
      gpsSource: {
        title: "GPS Position Source",
        type: "string",
        description:
          "If there are multiple sources of navigation.position, then specify which one we should use.",
      },
      trackInterval: {
        title: "Time Interval (minutes)",
        type: "number",
        minimum: 0.1,
        description: `Number of minutes between recorded track positions (default is ${DEFAULT_TRACK_INTERVAL} minutes).`,
        default: DEFAULT_TRACK_INTERVAL,
      },
      minimumSpeed: {
        title: "Minimum Speed (knots)",
        type: "number",
        minimum: 0,
        description: `The minimum speed over ground (SOG) required to trigger track recording. This prevents track 
            recording while anchored or docked. If set to 0, the track is recorded regardless of boat speed (default 
            is ${DEFAULT_MINIMUM_SPEED} knots).`,
        default: DEFAULT_MINIMUM_SPEED,
      },
      minimumDistance: {
        title: "Minimum Distance (meters)",
        type: "number",
        minimum: 0,
        description: `The minimum distance between recorded track points. This prevents track recording while anchored or 
            docked. If set to zero, the track is recorded regardless of distance between points (default is ${DEFAULT_MINIMUM_DISTANCE} meters).`,
        default: DEFAULT_MINIMUM_DISTANCE,
      },
      simplificationTolerance: {
        title: "Track Simplification Tolerance (meters)",
        type: "number",
        minimum: 0,
        description: `Simplify the saved track - by removing points where the track is pretty straight and keeping points where direction 
            changes. This produces a much smaller GPX file while maintaining good path resolution. If set to 0, track simplification will be
            disabled and the track will be saved at the full recorded resolution (default is ${DEFAULT_SIMPLIFICATION_TOLERANCE} meters).`,
        default: DEFAULT_SIMPLIFICATION_TOLERANCE,
      },
      gpxFolder: {
        title: "Folder Path",
        type: "string",
        description: `Folder path to save gpx files in. If left blank, default is $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/${plugin.id}.`,
      },
      recordVoyage: {
        type: "boolean",
        title: `Record Voyage?`,
        description: `Create GPX files for each complete voyage rather than every 24 hours (default is ${DEFAULT_RECORD_VOYAGE}).`,
        default: DEFAULT_RECORD_VOYAGE,
      },
      recordDepth: {
        title: "Record Depth?",
        type: "boolean",
        description: `Record the current depth (from water surface) at each track point using the Garmin extension format (default is ${DEFAULT_RECORD_DEPTH}).`,
        default: DEFAULT_RECORD_DEPTH,
      },
    },
  };

  plugin.registerWithRouter = (router) => {
    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/write-gpx-file-now
    router.get("/write-gpx-file-now", (_req, res) => {
      try {
        isPluginRunning();
        var message = writeDailyGpxFile(getYyyymmddhhmm(new Date()));
        res.json({ message: message });
      } catch (error) {
        app.error(error);
        res.status(500).send(error.message);
      }
    });

    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/clear-buffer-now
    router.get("/clear-buffer-now", (_req, res) => {
      try {
        isPluginRunning();
        clearBuffer();
        res.json();
      } catch (error) {
        app.error(error);
        res.status(500).send(error.message);
      }
    });

    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/buffer-count
    router.get("/buffer-count", (_req, res) => {
      res.json({ count: bufferCount });
    });

    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files
    router.get("/files", (_req, res) => {
      try {
        isPluginRunning();
        var files = fs.readdirSync(gpxFolder).filter(function (file) {
          return file.endsWith(".gpx");
        });
        res.json(files.slice(-100)); // limit to the 100 most recent files
      } catch (error) {
        app.error(error);
        res.status(500).send(error.message);
      }
    });

    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files/:filename
    router.get("/files/:fileName", (req, res) => {
      try {
        isPluginRunning();
        res.download(`${gpxFolder}/${req.params["fileName"]}`);
      } catch (error) {
        app.error(error);
        res.status(500).send(error.message);
      }
    });
  };

  function isPluginRunning() {
    if (!db || !gpxFolder) {
      throw new Error("Missing configuration. Is the plugin enabled?");
    }
  }

  function updatePluginStatus() {
    app.debug("updating server status message");
    var message =
      bufferCount +
      (bufferCount == 1 ? " entry" : " entries") +
      " in the local buffer.";

    if (filename) {
      message += ` Last GPX file saved ${filename}`;
    }

    app.setPluginStatus(message);
  }

  function processDelta(delta) {
    var update = delta.updates[0];
    var source = update.$source;

    if (gpsSource && source != gpsSource) {
      app.debug(`Skipping position from GPS source ${source}`);
      return;
    }

    var position = update.values[0].value;
    position.ts = new Date(update.timestamp).getTime();

    if (!validPosition(position)) {
      app.error("ERROR: Invalid position:", position);
      return;
    }

    if (recordDepth) {
      var depth = app.getSelfPath("environment.depth.belowSurface");
      if (
        depth &&
        depth.value &&
        depth.timestamp &&
        Date.now() - new Date(depth.timestamp).getTime() <
          MAX_DEPTH_AGE_IN_MILLIS
      ) {
        position.depth = depth.value;
      }
    }

    if (!lastRecordedPosition) {
      lastRecordedPosition = position;
    }

    var sog =
      app.getSelfPath("navigation.speedOverGround").value * KNOTS_PER_M_PER_S;
    var distance = getDistanceFromLatLonInMeters(
      lastRecordedPosition.latitude,
      lastRecordedPosition.longitude,
      position.latitude,
      position.longitude,
    );
    var isNewDay =
      new Date(position.ts).getDate() !=
      new Date(lastRecordedPosition.ts).getDate();
    var minutesSinceLastRecordedPosition =
      (Date.now() - lastRecordedPosition.ts) / 1000 / 60;
    var vesselStopped = minutesSinceLastRecordedPosition > 3 * trackInterval;
    // 50 meters / 1 minutes = 1.62 knots
    // 50 meters / 2 minutes = 0.81 knots
    // 50 meters / 3 minutes = 0.54 knots
    // 50 meters / 5 minutes = 0.32 knots

    app.debug(
      `bufferCount=${bufferCount} sog=${(sog || 0).toFixed(2)} distance=${(distance || 0).toFixed(2)} isNewDay=${isNewDay} minutesSinceLastRecordedPosition=${(minutesSinceLastRecordedPosition || 0).toFixed(2)} vesselStopped=${vesselStopped} `,
    );

    if (sog >= minimumSpeed && distance >= minimumDistance) {
      addPositionToBuffer(position);
      lastRecordedPosition = position;
    }

    // daily gpx
    if (!recordVoyage && bufferCount > 1 && isNewDay) {
      app.debug("starting a new day - writing gpx file");
      try {
        writeDailyGpxFile(
          getYyyymmdd(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ); // use yesterdays date
        clearBuffer(true); // keep last row - so that the series of gpx files are gapless
      } catch (err) {
        app.error(`Error writing GPX file: ${err}`);
      }
    }

    // gpx per voyage (not daily)
    if (recordVoyage && bufferCount > 1 && vesselStopped) {
      app.debug("end of voyage detected - writing gpx file");
      // record voyage end position
      addPositionToBuffer(position);
      lastRecordedPosition = position;
      try {
        writeDailyGpxFile(getYyyymmddhhmm(new Date(lastRecordedPosition.ts)));
        clearBuffer();
      } catch (err) {
        app.error(`Error writing GPX file: ${err}`);
      }
    }
  }

  function validPosition(position) {
    if (
      !position ||
      !position.latitude ||
      !position.longitude ||
      Math.abs(position.latitude) > 90 ||
      Math.abs(position.longitude) > 180 ||
      // aparently some GPSs return small non-zero lat/lng when they lose fix, so:
      (Math.abs(position.latitude) <= 0.01 &&
        Math.abs(position.longitude) <= 0.01)
    ) {
      return false;
    }
    return true;
  }

  // e.g. 2025-03-17
  function getYyyymmdd(date) {
    return (
      date.getFullYear() +
      "-" +
      (date.getMonth() + 1).toString().padStart(2, "0") +
      "-" +
      date.getDate().toString().padStart(2, "0")
    );
  }

  // e.g. 2025-03-17-1426
  function getYyyymmddhhmm(date) {
    return (
      getYyyymmdd(date) +
      "-" +
      date.getHours().toString().padStart(2, "0") +
      date.getMinutes().toString().padStart(2, "0")
    );
  }

  function setupSchema() {
    db.prepare(
      "CREATE TABLE IF NOT EXISTS buffer(ts REAL, latitude REAL, longitude REAL, depth REAL)",
    ).run();

    // update older versions of the buffer table
    var hasDepth = db
      .prepare(
        "select count(*) as count from pragma_table_info(?) where name=?",
      )
      .get("buffer", "depth").count;
    app.debug("hasDepth=", hasDepth);

    if (!hasDepth) {
      try {
        app.debug("adding depth column");
        db.prepare("ALTER TABLE buffer ADD COLUMN depth REAL").run();
      } catch (error) {
        app.error(error);
      }
    }
  }

  function getBufferCount() {
    return db.prepare("SELECT COUNT(*) AS count FROM buffer").get().count;
  }

  function addPositionToBuffer(position) {
    app.debug(
      "Storing position in local buffer",
      position.ts,
      position.latitude,
      position.longitude,
    );
    db.prepare("INSERT INTO buffer VALUES(?, ?, ?, ?)").run(
      position.ts,
      position.latitude,
      position.longitude,
      position.depth,
    );
    bufferCount++;
    updatePluginStatus();
  }

  function clearBuffer(keepLast) {
    app.debug("clearing buffer");
    db.prepare(
      "DELETE FROM buffer" +
        (keepLast
          ? " where ts not in (select ts from buffer order by ts desc limit 1)"
          : ""),
    ).run();
    bufferCount = getBufferCount();
    updatePluginStatus();
  }

  function writeDailyGpxFile(name) {
    var trackPoints = db.prepare("SELECT * FROM buffer order by ts").all();

    if (!trackPoints || trackPoints.length == 0) {
      throw new Error("The local buffer is empty");
    }

    app.debug(`${trackPoints.length} positions in buffer`);

    if (simplificationTolerance && simplificationTolerance > 0) {
      trackPoints = simplifyTrack(trackPoints, simplificationTolerance);
      app.debug(
        `Simplified track to ${trackPoints.length} positions with simplification tolerance ${simplificationTolerance}`,
      );
    }

    app.debug(`Writing ${trackPoints.length} positions to gpx file`);

    var lastTrackPointDate = new Date(trackPoints[trackPoints.length - 1].ts);
    app.debug("lastTrackPointDate", lastTrackPointDate);

    var gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" 
version="1.1" creator="${plugin.name}"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd
http://www.garmin.com/xmlschemas/TrackPointExtension/v1 https://www8.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">
<trk><name>${name}</name><trkseg>\n`;

    for (let trackPoint of trackPoints) {
      gpx += `<trkpt lat="${trackPoint.latitude.toFixed(GPX_LAT_LONG_DECIMAL_PLACES)}" lon="${trackPoint.longitude.toFixed(GPX_LAT_LONG_DECIMAL_PLACES)}"><time>${new Date(trackPoint.ts).toISOString()}</time>`;

      if (recordDepth && trackPoint.depth) {
        gpx += `<extensions><gpxtpx:TrackPointExtension><gpxtpx:depth>${trackPoint.depth.toFixed(GPX_DEPTH_DECIMAL_PLACES)}</gpxtpx:depth></gpxtpx:TrackPointExtension></extensions>`;
      }

      gpx += `</trkpt>\n`;
    }

    gpx += "</trkseg></trk></gpx>";

    if (!fs.existsSync(gpxFolder)) {
      try {
        fs.mkdirSync(gpxFolder, { recursive: true });
      } catch (err) {
        throw new Error("Error creating folder for gpx file:", err);
      }
    }

    filename = name + ".gpx";
    var fqFilename = path.join(gpxFolder, filename);
    app.debug("Writing gpx file", fqFilename);
    try {
      fs.writeFileSync(fqFilename, gpx);
    } catch (err) {
      throw new Error("Error writing gpx file:", err);
    }

    updatePluginStatus();
    app.debug("done Writing gpx file", fqFilename);
    return `Saved ${filename}`;
  }

  function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000; // Radius of the earth in m
    var dLat = deg2rad(lat2 - lat1); // deg2rad below
    var dLon = deg2rad(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in m
    return d;
  }

  function deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  function simplifyTrack(trackPoints, simplificationTolerance) {
    // EPSG:4326 = WGS84 (lat/lon degrees)
    // EPSG:3857 = Web Mercator (x/y in meters)
    const projWGS84 = "EPSG:4326";
    const projWebMerc = "EPSG:3857";

    // project lat/lon degrees to x/y meter coordinates
    trackPoints.forEach((trackPoint) => {
      [trackPoint.x, trackPoint.y] = proj4(projWGS84, projWebMerc, [
        trackPoint.longitude,
        trackPoint.latitude,
      ]);
    });

    // Simplify (tolerance in meters)
    const simplifiedTrackPoints = simplify(
      trackPoints,
      simplificationTolerance,
      true,
    );

    return simplifiedTrackPoints;
  }

  return plugin;
}
