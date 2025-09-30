
Remove-Item C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\*.js
Remove-Item C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\*.cjs
Remove-Item C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\*.mjs
Remove-Item C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\*.json

Copy-Item -Force -Path "..\public" -Destination "C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\" -Recurse
Copy-Item -Force -Path "..\src" -Destination "C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\" -Recurse
Copy-Item -Force -Path "..\*.js" -Destination "C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\"
Copy-Item -Force -Path "..\*.mjs" -Destination "C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\"
Copy-Item -Force -Path "..\*.json" -Destination "C:\signalk\signalkhome\.signalk\node_modules\signalk-daily-gpx-plugin\"
