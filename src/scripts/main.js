import "bootstrap";

const baseUrl = "/plugins/signalk-daily-gpx-plugin";

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
      }
    }
  } catch (error) {
    console.error(error);
    appendAlert(`Error getting list of gpx files: ${error.message}`, "danger");
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

const alertPlaceholder = document.getElementById("liveAlertPlaceholder");

const appendAlert = (message, type) => {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = [
    `<div class="alert alert-${type} alert-dismissible" role="alert">`,
    `   <div>${message}</div>`,
    '   <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>',
    "</div>",
  ].join("");

  alertPlaceholder.append(wrapper);
};

document
  .getElementById("write-gpx-file-now")
  .addEventListener("click", saveGpx);
document
  .getElementById("clear-buffer-now")
  .addEventListener("click", clearBuffer);

showBufferCount();
showFiles();
