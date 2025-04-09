/*
 * signalk-daily-gpx-plugin
 * Jeremy Waters <jaffadog@gmail.com>"
 */

const GPX_LAT_LONG_DECIMAL_PLACES = 6;

const fs = require('fs');
const filePath = require('path');
const sqlite3 = require('sqlite3');

module.exports = function (app) {
    var plugin = {};
    var db;
    var previousSavedPosition;
    var gpsSource;
    var trackInterval;
    var minimumMoveDistance;
    var gpxFolder;
    var filename;
    var unsubscribes = [];

    plugin.id = "signalk-daily-gpx-plugin";
    plugin.name = "SignalK Daily GPX Plugin";
    plugin.description = "A SignalK plugin that writes a daily GPX file";

    plugin.start = function (options) {
        app.debug('Plugin started');

        gpsSource = options.gpsSource;
        trackInterval = options.trackInterval;
        minimumMoveDistance = options.minimumMoveDistance;
        gpxFolder = options.gpxFolder ? gpxFolder : app.getDataDirPath();

        var dbFile = filePath.join(app.getDataDirPath(), plugin.id + '.sqlite3');
        db = new sqlite3.Database(dbFile, function (err) {
            if (err) {
                app.debug('Error opening database:', err);
                throw err;
            }
            app.debug('creating buffer table');
            db.run('CREATE TABLE IF NOT EXISTS buffer(ts REAL, latitude REAL, longitude REAL)', function (err) {
                if (err) {
                    app.debug('Error creating buffer:', err);
                }
                previousSavedPosition = getPreviousSavedPosition();
            });
        });

        var localSubscription = {
            context: 'vessels.self',
            subscribe: [{
                path: 'navigation.position',
                period: trackInterval * 60 * 1000
            }]
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
                db.close(function (err) {
                    if (err) {
                        app.debug('error closing db', err);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    };

    plugin.schema = {
        type: 'object',
        description: `NOTE:\nThe plugin will store track positions in a local buffer and will write the gpx file after 
            midnight every day (per the signal K server clock) - so you will not find a gpx file until after midnight. 
            If you want to force a GPX file to be written, use http://raspberrypi.local/plugins/${plugin.id}/write-gpx-file-now. 
            If you want to clear the local buffer, use http://raspberrypi.local/plugins/${plugin.id}/clear-buffer-now.`,
        required: ['trackInterval'],
        properties: {
            gpsSource: {
                title: 'GPS Position Source',
                type: 'string',
                description: 'If there are multiple sources of navigation.position, then specify which one we should use'
            },
            trackInterval: {
                title: 'Time Interval (minutes)',
                type: 'number',
                description: 'Number of minutes between recorded track points (default is 10 minutes)',
                default: 10
            },
            minimumMoveDistance: {
                title: 'Minimum Move Distance (meters)',
                type: 'number',
                description: `The minimum boat movement in the specified time interval required before recording a track point. 
                    This prevents track recording while anchored or docked. If blank, the track is recorded regardless of movement. 
                    (default is 100 meters)`,
                default: 100
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
            writeDailyGpxFile().then(
                (ok) => {
                    res.json({ "message": ok });
                },
                (err) => {
                    res.status(500).json({ "message": err });
                }
            );
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/clear-buffer-now
        router.get('/clear-buffer-now', (req, res) => {
            clearBuffer();
            res.json();
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/buffer-size
        router.get('/buffer-size', async (req, res) => {
            var size = await getBufferSize();
            res.json({ "size": size });
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files
        router.get('/files', (req, res) => {
            var files = fs.readdirSync(gpxFolder);
            res.json(files);
        });

        // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/files/*
        router.get('/files/:fileName', (req, res) => {
            res.download(`${gpxFolder}/${req.params['fileName']}`);
        });
    };

    function getPreviousSavedPosition() {
        db.get('SELECT * FROM buffer order by ts desc limit 1', function (err, row) {
            if (err) {
                app.debug('Error querying the local buffer:', err);
                return;
            }

            if (row && row.timestamp) {
                return row;
            }
        });
    };

    function getBufferSize() {
        return new Promise(function (resolve, reject) {
            db.get('SELECT COUNT(*) AS count FROM buffer', function (err, row) {
                if (err) {
                    app.debug('Error querying the local buffer:', err);
                    resolve(0);
                    return;
                }

                resolve(row.count);
            });
        });
    }

    async function updatePluginStatus() {
        app.debug('updating server status message');
        var size = await getBufferSize();
        var message = size + (size == 1 ? ' entry' : ' entries') + ' in the local buffer.';

        if (filename) {
            message += ` Last GPX file saved ${filename}`;
        }

        app.setPluginStatus(message);
    };

    async function processDelta(delta) {

        // sample delta:
        // delta { context: 'vessels.urn:mrn:imo:mmsi:368204530', updates: [ { source: [Object], '$source': 'vesper.GP', timestamp: '2025-03-17T03:03:18.000Z', values: [Array] } ] }

        var update = delta.updates[0];
        var source = update.$source;

        if (gpsSource && source != gpsSource) {
            app.debug(`Skipping position from GPS source ${source}`);
            return;
        }

        var position = update.values[0].value;
        position.timestamp = new Date(update.timestamp).getTime();

        var distanceMoved;

        if (previousSavedPosition && minimumMoveDistance) {
            distanceMoved = getDistanceFromLatLonInMeters(previousSavedPosition.latitude, previousSavedPosition.longitude, position.latitude, position.longitude);
            app.debug('distanceMoved:', distanceMoved.toFixed(1));
            if (distanceMoved < minimumMoveDistance) {
                app.debug(`Skipping this point. Did not move far enough ${distanceMoved.toFixed(1)} < ${minimumMoveDistance}`);
                return;
            }
        }

        await addPositionToBuffer(position);

        if (previousSavedPosition && new Date(position.timestamp).getDate() != new Date(previousSavedPosition.timestamp).getDate()) {
            app.debug('starting a new day - time to write the gpx file');
            try {
                // await writeDailyGpxFile();
                writeDailyGpxFile().then(
                    (ok) => {
                        // clear the buffer, but keep the last position so that it becomes the start point in the next gpx file so 
                        // that consecutive gpx files have no gaps in the track 
                        clearBuffer(true);
                    },
                    (err) => {
                        app.debug(`Error saving gpx ${err}`);
                    }
                );
            } catch (err) {
                app.debug(`Error writing GPX file: ${err}`);
            }
        }

        previousSavedPosition = position;
    };

    async function addPositionToBuffer(position) {
        app.debug('Storing position in local buffer', position.timestamp, position.latitude, position.longitude);
        db.run('INSERT INTO buffer VALUES(?, ?, ?)', [position.timestamp, position.latitude, position.longitude], function (err) {
            if (err) {
                app.debug('Error inserting data into the local buffer:', err);
                return;
            }
            updatePluginStatus();
        });
    };

    function writeDailyGpxFile() {
        return new Promise(function (resolve, reject) {
            db.all('SELECT * FROM buffer ORDER BY ts', function (err, trackPoints) {
                if (err) {
                    app.debug('Error querying the local buffer:', err);
                    reject(err);
                    return;
                }
                if (!trackPoints || trackPoints.length == 0) {
                    app.debug('The local buffer is empty');
                    reject("The local buffer is empty");
                    return;
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
                        app.debug('Error creating folder for gpx file:', err);
                        reject(err);
                        return;
                    }
                }

                filename = trackName + '.gpx';
                var fqFilename = filePath.join(gpxFolder, filename);
                app.debug('Writing gpx file', fqFilename);
                try {
                    fs.writeFileSync(fqFilename, gpx);
                } catch (err) {
                    app.debug('Error writing gpx file:', err);
                    reject(err);
                    return;
                }

                updatePluginStatus();
                app.debug('done Writing gpx file', fqFilename);
                resolve(`Saved ${filename}`);
            });
        });
    };

    function clearBuffer(keepLast) {
        app.debug('clearing buffer');
        db.run('DELETE FROM buffer' + (keepLast ? ' where ts not in (select ts from buffer order by ts desc limit 1)' + lastTs : ''), function (err) {
            if (err) {
                app.debug('Error clearing the local buffer:', err);
                return;
            }
            updatePluginStatus();
            app.debug('done clearing buffer');
        });
    };

    function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
        var R = 6371000; // Radius of the earth in m
        var dLat = deg2rad(lat2 - lat1);  // deg2rad below
        var dLon = deg2rad(lon2 - lon1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
            ;
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        var d = R * c; // Distance in m
        return d;
    };

    function deg2rad(deg) {
        return deg * (Math.PI / 180)
    };

    return plugin;
};
