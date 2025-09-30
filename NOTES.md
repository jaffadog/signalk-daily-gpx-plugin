# deploying new version:

update package.json "version"
check in to github
create a new release/tag in github - e.g. 0.0.3

deploy in npm:

npm adduser

npm publish

if you get a 404 error when trying to publish, do adduser again

# gpx depth extension

```
<trkpt lat="37.7749" lon="-122.4194">
  <ele>10.5</ele>
  <time>2023-10-27T12:00:00Z</time>
  <extensions>
    <TrackPointExtensionv1>
      <depth>5.2</depth>
    </TrackPointExtensionv1>
  </extensions>
</trkpt>

<?xml version="1.0" encoding="utf-8"?>

<gpx xmlns:tc2="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:tp1="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
xmlns="http://www.topografix.com/GPX/1/1"
version="1.1" creator="TC2 to GPX11 XSLT stylesheet"
xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">
<trk>
<name>2013-12-03T21:08:56Z</name>
<trkseg>
<trkpt lat="45.4852855" lon="-122.6347885">
<ele>0.0000000</ele>
<time>2013-12-03T21:08:56Z</time>
</trkpt>
<trkpt lat="45.4852961" lon="-122.6347926">
<ele>0.0000000</ele>
<time>2013-12-03T21:09:00Z</time>
</trkpt>
<trkpt lat="45.4852982" lon="-122.6347897">
<ele>0.2000000</ele>
<time>2013-12-03T21:09:01Z</time>
</trkpt>
</trkseg>
</trk>
</gpx>
```
