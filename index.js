/*
 * signalk-daily-gpx-plugin
 * Jeremy Waters <jaffadog@gmail.com>"
 */

const GPX_LAT_LONG_DECIMAL_PLACES = 6;
const METERS_PER_DEG_LAT = 111120;
const KNOTS_PER_M_PER_S = 1.94384;

const DEFAULT_TRACK_INTERVAL = 1;
const DEFAULT_MINIMUM_SPEED = 0.5;
const DEFAULT_SIMPLIFICATION_TOLERANCE = 10;

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const simplify = require('./simplify.js');

module.exports = function (app) {
    var plugin = {};
    var db;
    var previousPosition;
    var filename;
    var bufferCount = 0;
    var unsubscribes = [];

    var gpsSource;
    var trackInterval;
    var minimumSpeed;
    var simplificationTolerance;
    var gpxFolder;

    plugin.id = "signalk-daily-gpx-plugin";
    plugin.name = "SignalK Daily GPX Plugin";
    plugin.description = "A SignalK plugin that writes a daily GPX file";

    plugin.start = function (options) {
        app.debug('Plugin started with options=', options);

        gpsSource = options.gpsSource;
        trackInterval = options.trackInterval || DEFAULT_TRACK_INTERVAL;
        minimumSpeed = options.minimumSpeed ?? DEFAULT_MINIMUM_SPEED;
        simplificationTolerance = options.simplificationTolerance ?? DEFAULT_SIMPLIFICATION_TOLERANCE;
        gpxFolder = options.gpxFolder ? options.gpxFolder : app.getDataDirPath();

        var dbFile = path.join(app.getDataDirPath(), plugin.id + '.sqlite3');
        db = new Database(dbFile, { verbose: app.debug });
        db.prepare('CREATE TABLE IF NOT EXISTS buffer(ts REAL, latitude REAL, longitude REAL)').run();

        bufferCount = getBufferCount();

        var localSubscription = {
            context: 'vessels.self',
            subscribe: [
                {
                    path: 'navigation.position',
                    period: trackInterval * 60 * 1000
                }
            ]
        };

        app.subscriptionmanager.subscribe(
            localSubscription,
            unsubscribes,
            subscriptionError => {
                app.error('Error:' + subscriptionError);
            },
            delta => processDelta(delta)
        );
    };

    plugin.stop = function () {
        app.debug(`Stopping the plugin`);
        return new Promise(function (resolve, reject) {
            unsubscribes.forEach(f => f());
            unsubscribes = [];
            if (db) {
                app.debug('closing db');
                try {
                    db.close();
                } catch (err) {
                    app.debug('error closing db', err);
                }
            }
            resolve();
        });
    };

    plugin.schema = {
        type: 'object',
        description: `NOTE: The plugin will store track positions in a local buffer and will write the gpx file at 
            midnight (per the signal K server clock). You can review and download available gpx files in the 
            SignalK Daily GPX Plugin webapp.`,
        required: ['trackInterval', 'minimumSpeed', 'simplificationTolerance'],
        properties: {
            gpsSource: {
                title: 'GPS Position Source',
                type: 'string',
                description: 'If there are multiple sources of navigation.position, then specify which one we should use'
            },
            trackInterval: {
                title: 'Time Interval (minutes)',
                type: 'number',
                minimum: 0.1,
                description: `Number of minutes between recorded track positions (default is ${DEFAULT_TRACK_INTERVAL} minutes)`,
                default: DEFAULT_TRACK_INTERVAL
            },
            minimumSpeed: {
                title: 'Minimum Speed (knots)',
                type: 'number',
                minimum: 0,
                description: `The minimum speed over ground (SOG) required to trigger track recording. This prevents track 
                recording while anchored or docked. If set to 0, the track is recorded at the specified time interval regardless 
                of boat speed. (default is ${DEFAULT_MINIMUM_SPEED} knots)`,
                default: DEFAULT_MINIMUM_SPEED
            },
            simplificationTolerance: {
                title: 'Track Simplification Tolerance (meters)',
                type: 'number',
                minimum: 0,
                description: `Simplify the saved track - by removing points where the track is pretty straight and keeping points where direction 
                    changes. This produces a much smaller GPX file while maintaining good path resolution. If set to 0, track simplification will be
                    disabled and the track will be saved at the full recorded resolution (default is ${DEFAULT_SIMPLIFICATION_TOLERANCE} meters)`,
                default: DEFAULT_SIMPLIFICATION_TOLERANCE
            },
            gpxFolder: {
                title: 'Folder Path',
                type: 'string',
                description: `Folder path to save gpx files in. If left blank, default is $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/${plugin.id}.`
            }
        }
    };

    plugin.registerWithRouter = (router) => {
        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/write-gpx-file-now
        router.get('/write-gpx-file-now', (req, res) => {
            try {
                var message = writeDailyGpxFile();
                res.json({ "message": message });
            } catch (err) {
                app.debug('err', err);
                res.status(500).json({ "message": err.message });
            }
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/clear-buffer-now
        router.get('/clear-buffer-now', (req, res) => {
            clearBuffer();
            res.json();
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/buffer-count
        router.get('/buffer-count', (req, res) => {
            res.json({ "count": bufferCount });
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files
        router.get('/files', (req, res) => {
            var files = fs.readdirSync(gpxFolder).filter(function (file) {
                return (file.endsWith('.gpx'));
            });
            res.json(files.slice(-100)); // limit to the 100 most recent files
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files/:filename
        router.get('/files/:fileName', (req, res) => {
            res.download(`${gpxFolder}/${req.params['fileName']}`);
        });
    };

    function getBufferCount() {
        return db.prepare('SELECT COUNT(*) AS count FROM buffer').get().count;
    }

    function updatePluginStatus() {
        app.debug('updating server status message');
        var message = bufferCount + (bufferCount == 1 ? ' entry' : ' entries') + ' in the local buffer.';

        if (filename) {
            message += ` Last GPX file saved ${filename}`;
        }

        app.setPluginStatus(message);
    };

    function processDelta(delta) {
        var update = delta.updates[0];
        var source = update.$source;

        if (gpsSource && source != gpsSource) {
            app.debug(`Skipping position from GPS source ${source}`);
            return;
        }

        var position = update.values[0].value;
        position.ts = new Date(update.timestamp).getTime();

        if (previousPosition && new Date(position.ts).getDate() != new Date(previousPosition.ts).getDate() && bufferCount > 1) {
            app.debug('starting a new day - time to write the gpx file');
            try {
                writeDailyGpxFile();
                clearBuffer(true);
            } catch (err) {
                app.debug(`Error writing GPX file: ${err}`);
            }
        }

        var sog = app.getSelfPath("navigation.speedOverGround").value * KNOTS_PER_M_PER_S;

        if (bufferCount == 0
            || !minimumSpeed
            || sog >= minimumSpeed) {
            addPositionToBuffer(position);
        }

        previousPosition = position;
    };

    function addPositionToBuffer(position) {
        app.debug('Storing position in local buffer', position.ts, position.latitude, position.longitude);
        db.prepare('INSERT INTO buffer VALUES(?, ?, ?)').run(position.ts, position.latitude, position.longitude);
        bufferCount++;
        updatePluginStatus();
    };

    function writeDailyGpxFile() {
        var trackPoints = db.prepare('SELECT * FROM buffer order by ts').all();

        if (!trackPoints || trackPoints.length == 0) {
            throw new Error('The local buffer is empty');
        }

        app.debug(`${trackPoints.length} positions in buffer`);

        if (simplificationTolerance && simplificationTolerance > 0) {
            trackPoints = simplify(trackPoints, simplificationTolerance / METERS_PER_DEG_LAT, true);
            app.debug(`Simplified track to ${trackPoints.length} positions with simplification tolerance ${simplificationTolerance}`);
        }

        app.debug(`Writing ${trackPoints.length} positions to gpx file`);

        var lastTrackPointDate = new Date(trackPoints[trackPoints.length - 1].ts)
        app.debug('lastTrackPointDate', lastTrackPointDate);

        // e.g. 2025-03-17-1426
        var trackName = lastTrackPointDate.getFullYear() + '-'
            + (lastTrackPointDate.getMonth() + 1).toString().padStart(2, "0") + '-'
            + lastTrackPointDate.getDate().toString().padStart(2, "0") + '-'
            + lastTrackPointDate.getHours().toString().padStart(2, "0")
            + lastTrackPointDate.getMinutes().toString().padStart(2, "0");

        app.debug('trackName', trackName);
        var gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${plugin.name}"><trk><name>${trackName}</name><trkseg>\n`;

        for (let trackPoint of trackPoints) {
            gpx += `<trkpt lat="${trackPoint.latitude.toFixed(GPX_LAT_LONG_DECIMAL_PLACES)}" lon="${trackPoint.longitude.toFixed(GPX_LAT_LONG_DECIMAL_PLACES)}"><time>${new Date(trackPoint.ts).toISOString()}</time></trkpt>\n`;
        }

        gpx += '</trkseg></trk></gpx>';

        if (!fs.existsSync(gpxFolder)) {
            try {
                fs.mkdirSync(gpxFolder, { recursive: true });
            } catch (err) {
                throw new Error('Error creating folder for gpx file:', err);
            }
        }

        filename = trackName + '.gpx';
        var fqFilename = path.join(gpxFolder, filename);
        app.debug('Writing gpx file', fqFilename);
        try {
            fs.writeFileSync(fqFilename, gpx);
        } catch (err) {
            throw new Error('Error writing gpx file:', err);
        }

        updatePluginStatus();
        app.debug('done Writing gpx file', fqFilename);
        return `Saved ${filename}`;
    };

    function clearBuffer(keepLast) {
        app.debug('clearing buffer');
        db.prepare('DELETE FROM buffer' + (keepLast ? ' where ts not in (select ts from buffer order by ts desc limit 1)' : '')).run();
        bufferCount = keepLast ? 1 : 0;
        updatePluginStatus();
    };

    return plugin;
};
