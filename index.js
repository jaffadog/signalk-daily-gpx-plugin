/*
 * signalk-daily-gpx-plugin
 */

const fs = require('fs');
const filePath = require('path')
const sqlite3 = require('sqlite3')

module.exports = function(app) {
  var plugin = {};
  var configuration;
  var db;
  var position;
  var gpsSource;
  var trackInterval;
  var gpxFolder;
  var previousTimestamp;
  var filename;
  var unsubscribes = [];

  plugin.id = "signalk-daily-gpx-plugin";
  plugin.name = "signalk-daily-gpx-plugin";
  plugin.description = "A SignalK plugin that writes a daily GPX file";

  plugin.start = function(options) {
      app.debug('Plugin started');

      gpsSource = options.gpsSource;
      trackInterval = options.trackInterval;
      gpxFolder = options.gpxFolder ? gpxFolder : app.getDataDirPath();
      
      let dbFile = filePath.join( app.getDataDirPath(), plugin.id + '.sqlite3');
      db = new sqlite3.Database(dbFile);
      db.run('CREATE TABLE IF NOT EXISTS buffer(ts REAL, latitude REAL, longitude REAL)');
      db.run('CREATE TABLE IF NOT EXISTS configuration(id INTEGER PRIMARY KEY, config TEXT)');
      
      //clearBuffer();

      let localSubscription = {
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
  }

  plugin.stop = function() {
    app.debug(`Stopping the plugin`);
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  };

  plugin.schema = {
      type: 'object',
      description: `NOTE:
      \n
      The plugin will store track positions in a local cache and will write the gpx file after 
      midnight every day (per the signal K server clock) - so you will not find a gpx file until after midnight.
      \n\n
      If you want to force a GPX file to be written, use http://raspberrypi.local/plugins/${plugin.id}/write-gpx-file-now.
      \n
      If you want to clear the local cache, use http://raspberrypi.local/plugins/${plugin.id}/clear-buffer-now.`,
      required: ['trackInterval'],
      properties: {
        gpsSource: {
          title: 'GPS position source',
          type: 'string',
          description: 'If there are multiple sources of navigation.position, then specify which one we should use'
        },
        trackInterval: {
          title: 'Time Interval',
          type: 'number',
          description: 'Number of minutes between recorded track points (default is 10 minutes)',
          default: 10
        },
        gpxFolder: {
          title: 'Folder Path',
          type: 'string',
          description: `Folder path to save gpx files in. If left blank, default is $SIGNALK_NODE_CONFIG_DIR/plugin-config-data/${plugin.id}.`,
        }
      }
  }

  // FIXME: make a simple webapp to expose buttons to trigger the actions below. or can we put buttons on the plugin config screen?
  plugin.registerWithRouter = (router) => {
    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/write-gpx-file-now
    router.get('/write-gpx-file-now', (req, res) => {
      writeDailyGpxFile()
        .then(
          function(ok) { res.send(`Saved ${filename}`); }, 
          function(err) {res.send(`Error saving file: ${err}`); }
        );
    });
    // http://raspberrypi.local/plugins/signalk-daily-gpx-plugin/clear-buffer-now
    router.get('/clear-buffer-now', (req, res) => {
      clearBuffer();
      res.send(`cache cleared at ${new Date().toISOString()}`);
    });
  };

  function updatePluginStatus() {
    app.debug('updating server status message');
    db.get('SELECT COUNT(*) AS count FROM buffer', function(err, row) {
        if (err) {
            app.debug('Error querying the local cache:', err);
        } else {
            let message;
            queueLength = row.count;
            if (queueLength == 1) {
                message = `${queueLength} entry in the local cache.`;
            } else {
                message = `${queueLength} entries in the local cache.`;
            }
            
            if (filename) {
              // FIXME: the server only displays short messages - so have to keep it short
              // message += ` Last GPX file saved ${Math.floor((new Date() - lastGpxFileDate)/1000/60)} minutes ago to ${filename}`;
              message += ` Last GPX file saved ${filename}`;
            }

            app.setPluginStatus(message);
        }
    });
  }

  function processDelta(delta) {
    
    // delta { context: 'vessels.urn:mrn:imo:mmsi:368204530', updates: [ { source: [Object], '$source': 'vesper.GP', timestamp: '2025-03-17T03:03:18.000Z', values: [Array] } ] }
    
    let dict = delta.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;
    let timestamp = delta.updates[0].timestamp;
    let source = delta.updates[0].$source;

    if ((gpsSource) && (source != gpsSource)) {
      app.debug(`Skipping position from GPS resource ${source}`);
      return;
    }
    
    //FIXME: dont save position if we have not moved very far from our previous position. let users specify a minimum movement threshold in the configuration.
    
    position = value;
    position.timestamp = new Date(timestamp).getTime();

    updateDatabase();
  }

  function updateDatabase() {
    app.debug('Storing position in local cache',position.timestamp, position.latitude, position.longitude);
    db.run('INSERT INTO buffer VALUES(?, ?, ?)', [position.timestamp, position.latitude, position.longitude], function(err) {
      if (err) {
        app.debug('Error inserting data into the local cache:', err);
        return;
      }
      updatePluginStatus();
    });
    
    // if we crossed midnight, then write the gpx file and clear the buffer
    if ( previousTimestamp && new Date(position.timestamp).getDate() != new Date(previousTimestamp).getDate() ) {
      app.debug('starting a new day - time to write the gpx file');
      writeDailyGpxFile(position.timestamp)
        .then( function() { clearBuffer(position.timestamp); } );
    }

    previousTimestamp = position.timestamp;
  }

  function writeDailyGpxFile(lastTs) {
    return new Promise(function(resolve,reject) {
      app.debug('Writing gpx file');
      db.all('SELECT * FROM buffer' + (lastTs ? ' where ts < ' + lastTs : '') + ' ORDER BY ts', function(err, data) {
        if (err) {
          app.debug('Error querying the local cache:', err);
          return;
        }
        if (!data || data.length == 0) {
          app.debug('No data in the local cache');
          return;
        }
        
        app.debug(`Writing ${data.length} positions to gpx file`);
        
        var lastTrackPointDate = new Date(data[data.length-1].ts)
        app.debug('lastTrackPointDate',lastTrackPointDate);

        // e.g. 2025-03-17-1426
        var trackName = lastTrackPointDate.getFullYear() + '-' 
                      + (lastTrackPointDate.getMonth()+1).toString().padStart(2, "0") + '-' 
                      + lastTrackPointDate.getDate().toString().padStart(2, "0") + '-' 
                      + lastTrackPointDate.getHours().toString().padStart(2, "0") 
                      + lastTrackPointDate.getMinutes().toString().padStart(2, "0");
        
        app.debug('trackName',trackName);
        
        //FIXME: use a more freindly metadata/name?
        // gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${plugin.name}"><metadata><name>${new Date().toDateString()}</name></metadata><trk><trkseg>`;
        // gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${plugin.name}"><metadata><name>${new Date().toISOString()}</name></metadata><trk><name>${new Date().toISOString()}</name><trkseg>`;
        gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${plugin.name}"><trk><name>${trackName}</name><trkseg>`;
        
        for (d in data) {
          gpx += `<trkpt lat="${data[d].latitude}" lon="${data[d].longitude}"><time>${new Date(data[d].ts).toISOString()}</time></trkpt>`;
        }
        
        gpx += '</trkseg></trk></gpx>';

        if(!fs.existsSync(gpxFolder)) {
          try {
            fs.mkdirSync(gpxFolder,{recursive:true});
          } catch (err) {
            app.debug('Error creating folder for gpx file:', err);
            reject(err);
          }
        }

        filename = filePath.join(gpxFolder, trackName + '.gpx');
        app.debug('Writing gpx file',filename);
        try {
          fs.writeFileSync(filename, gpx);
        } catch (err) {
          app.debug('Error writing gpx file:', err);
          reject(err);
        }
        
        updatePluginStatus();
        app.debug('done Writing gpx file');
        resolve();
      });
    });
  }
  
  function clearBuffer(lastTs) {
    app.debug('clearing buffer');
    db.run('DELETE FROM buffer' + (lastTs ? ' where ts < ' + lastTs : ''), function(err) {
      if (err) {
        app.debug('Error clearing the local cache:', err);
        return;
      }
      updatePluginStatus();
      app.debug('done clearing buffer');
    });
  }
  
  return plugin;
}
