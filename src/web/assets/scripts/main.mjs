import "bootstrap";
import * as L from "leaflet";
import * as protomapsL from "protomaps-leaflet";
import * as basemaps from "@protomaps/basemaps";
import { gpx } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import pmtilesUrl from "../ne_10m_land.pmtiles?url";

const parser = new DOMParser();
const baseUrl = "/plugins/signalk-daily-gpx-plugin";
const trackColors = [
  "red",
  "OrangeRed",
  "orange",
  "gold",
  "yellow",
  "lime",
  "Springgreen",
  "Deepskyblue",
  "blue",
  "Blueviolet",
];
const alertPlaceholder = document.getElementById("liveAlertPlaceholder");
var map;

var tracksGroup = L.featureGroup();
var trackNum = 0;

document
  .getElementById("write-gpx-file-now")
  .addEventListener("click", saveGpx);
document
  .getElementById("clear-buffer-now")
  .addEventListener("click", clearBuffer);
document
  .getElementById("nav-map-tab")
  .addEventListener("shown.bs.tab", initMap);

init();

async function showBufferCount() {
  const bufferCountSpan = document.getElementById("bufferCount");
  try {
    const response = await fetch(baseUrl + "/buffer-count");
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    var data = await response.json();
    bufferCountSpan.innerText = data.count;
  } catch (error) {
    console.error(error);
    appendAlert(
      `Error getting position buffer count: ${error.message}`,
      "danger",
    );
  }
}

async function showFiles() {
  const ul = document.getElementById("files");
  ul.innerHTML = "";
  try {
    const response = await fetch(baseUrl + "/files");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    var files = await response.json();

    if (!files || files.length == 0) {
      const li = document.createElement("li");
      li.textContent = "No GPX files saved yet...";
      ul.appendChild(li);
    } else {
      // reverse order so that most recent files are on top of the list
      for (let i = files.length - 1; i >= 0; i--) {
        const li = document.createElement("li");
        li.innerHTML = `<a href="${baseUrl}/files/${files[i]}">${files[i]}</a>`;
        ul.appendChild(li);

        addFileToMap(`${baseUrl}/files/${files[i]}`);
      }
      document.getElementById("fileCount").textContent = files.length;
    }
  } catch (error) {
    console.error(error);
    appendAlert(`Error getting list of gpx files: ${error.message}`, "danger");
  }
}

async function addFileToMap(file) {
  try {
    const response = await fetch(file);

    if (!response.ok) {
      throw new Error(await response.text());
    }

    var gpxBytes = await response.text();
    const gpxFile = parser.parseFromString(gpxBytes, "text/xml");
    const geoJson = gpx(gpxFile);

    let track = L.geoJSON(geoJson, {
      color: trackColors[trackNum % trackColors.length],
    }).addTo(map);

    track.bindPopup(
      `Track ${geoJson.features[0].properties.name}<br><a href="${file}">download</a>`,
    );

    track.on("mouseover", function () {
      track.setStyle({
        weight: 4,
      });
    });

    track.on("mouseout", function () {
      track.setStyle({
        weight: 2,
      });
    });

    tracksGroup.addLayer(track);
    trackNum++;
  } catch (error) {
    console.error(error);
    //appendAlert(`Error getting gpx file: ${file}`, "danger");
  }
}

async function saveGpx() {
  try {
    const response = await fetch(baseUrl + "/write-gpx-file-now");
    if (response.ok) {
      var data = await response.json();
      appendAlert(data.message, "success");
    } else {
      throw new Error(await response.text());
    }
    showFiles();
  } catch (error) {
    console.error(error);
    appendAlert(`Error saving gpx file: ${error.message}`, "danger");
  }
}

async function clearBuffer() {
  try {
    const response = await fetch(baseUrl + "/clear-buffer-now");
    if (response.ok) {
      appendAlert("Buffer cleared", "success");
    } else {
      throw new Error(await response.text());
    }
    showBufferCount();
  } catch (error) {
    console.error(error);
    appendAlert(`Error clearing buffer: ${error.message}`, "danger");
  }
}

const appendAlert = (message, type) => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = [
    `<div class="alert alert-${type} alert-dismissible" role="alert">`,
    `   <div>${message}</div>`,
    '   <button type="button" class="btn-close" data-bs-dismiss="alert"></button>',
    "</div>",
  ].join("");

  alertPlaceholder.append(wrapper);
};

function setupMap() {
  map = L.map("map", { renderer: L.canvas({ tolerance: 15 }) });

  map.zoomControl.setPosition("topright");

  var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  });

  var openTopoMap = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
    },
  );

  var satLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 17,
      maxZoom: 20,
      attribution: "© Esri © OpenStreetMap Contributors",
    },
  );

  // protomaps color flavors: light dark white grayscale black
  var paintRules = protomapsL.paintRules(basemaps.namedFlavor("dark"));
  var labelRules = protomapsL.labelRules(basemaps.namedFlavor("dark"));

  var naturalEarth10m = protomapsL.leafletLayer({
    url: pmtilesUrl,
    maxDataZoom: 5,
    paintRules: paintRules,
    labelRules: labelRules,
  });

  var baseMaps = {
    Empty: L.tileLayer(""),
    OpenStreetMap: osm,
    OpenTopoMap: openTopoMap,
    Satellite: satLayer,
    "NaturalEarth (offline)": naturalEarth10m,
  };

  var OpenSeaMap = L.tileLayer(
    "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "",
    },
  );

  var overlayMaps = {
    OpenSeaMap: OpenSeaMap,
  };

  L.control.layers(baseMaps, overlayMaps, { position: "topleft" }).addTo(map);

  baseMaps["Satellite"].addTo(map);
  overlayMaps["OpenSeaMap"].addTo(map);
}

function initMap() {
  map.invalidateSize();
  if (tracksGroup.getLayers().length > 0) {
    map.fitBounds(tracksGroup.getBounds());
    tracksGroup.getLayers()[0].openPopup();
  }
}

function init() {
  showBufferCount();
  showFiles();
  setupMap();
}
