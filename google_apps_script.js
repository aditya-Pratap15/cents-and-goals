/**
 * 🚀 CENTS & GOALS - GOOGLE DRIVE MULTI-PHASE BRIDGE (Apps Script)
 * -------------------------------------------------------------
 * Target Google Drive Root Folder ID: 1pDTjs0cI0jucYTeVYf8ejfPmv-IZ2INY
 * 
 * Manages two subfolders:
 * 1. "before" -> Contains the 5 scraped raw photos and today_raw_posts.json
 * 2. "after"  -> Contains the transformed photos and today_transformed.json
 *
 * Supported Actions:
 * - GET ?action=get_before          : Returns all photos & JSON from "before" folder
 * - GET ?action=get_after           : Returns all photos & JSON from "after" folder
 * - GET ?action=download&fileId=... : Returns file base64 content
 * - POST { action: "upload_before", files: [...] } : Cleans & saves raw photos + json into "before"
 * - POST { action: "upload_after",  files: [...] } : Saves transformed photos + json into "after"
 * - POST { action: "clean_after" }  : Wipes the "after" subfolder so it is clean for the next day
 * - POST { action: "clean_before" } : Wipes the "before" subfolder
 */

var ROOT_FOLDER_ID = "1pDTjs0cI0jucYTeVYf8ejfPmv-IZ2INY";

function getSubFolder(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(name);
}

function clearFolder(folder) {
  var files = folder.getFiles();
  var count = 0;
  while (files.hasNext()) {
    var file = files.next();
    file.setTrashed(true);
    count++;
  }
  return count;
}

/**
 * GET Request Handler
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "health";
    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);

    if (action === "get_before" || action === "get_after") {
      var folderName = action === "get_before" ? "before" : "after";
      var subFolder = getSubFolder(root, folderName);
      var filesIter = subFolder.getFiles();
      var filesList = [];
      var metadataContent = null;

      while (filesIter.hasNext()) {
        var f = filesIter.next();
        var fname = f.getName();
        var fmime = f.getMimeType();

        if (fname.endsWith(".json")) {
          try {
            metadataContent = JSON.parse(f.getBlob().getDataAsString());
          } catch (err) {}
        }

        filesList.push({
          id: f.getId(),
          name: fname,
          mimeType: fmime,
          size: f.getSize(),
          created: f.getDateCreated().toISOString(),
          downloadUrl: "https://drive.google.com/uc?export=download&id=" + f.getId(),
          directUrl: "https://lh3.googleusercontent.com/d/" + f.getId()
        });
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        folder: folderName,
        folderId: subFolder.getId(),
        count: filesList.length,
        files: filesList,
        metadata: metadataContent
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "download" && e.parameter.fileId) {
      var file = DriveApp.getFileById(e.parameter.fileId);
      var bytes = file.getBlob().getBytes();
      var b64 = Utilities.base64Encode(bytes);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        id: file.getId(),
        name: file.getName(),
        mimeType: file.getMimeType(),
        base64: b64,
        directUrl: "https://lh3.googleusercontent.com/d/" + file.getId()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Default Health Check
    return ContentService.createTextOutput(JSON.stringify({
      status: "active",
      service: "Cents and Goals Google Drive Bridge",
      folderId: ROOT_FOLDER_ID,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * POST Request Handler
 */
function doPost(e) {
  try {
    var raw = "";
    if (e && e.postData && e.postData.contents) {
      raw = e.postData.contents;
    } else if (e && e.parameter && e.parameter.payload) {
      raw = e.parameter.payload;
    }

    if (!raw) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Empty request payload"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(raw);
    var action = data.action || "";
    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);

    // 1. Upload to "before" (Optionally clears previous before assets)
    if (action === "upload_before") {
      var beforeFolder = getSubFolder(root, "before");
      if (data.clearFirst !== false) {
        clearFolder(beforeFolder);
      }

      var uploaded = [];
      var files = data.files || [];
      for (var i = 0; i < files.length; i++) {
        var item = files[i];
        var decoded = Utilities.base64Decode(item.base64);
        var blob = Utilities.newBlob(decoded, item.mimeType || "application/octet-stream", item.filename);
        var createdFile = beforeFolder.createFile(blob);
        try {
          createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {}
        uploaded.push({
          id: createdFile.getId(),
          name: createdFile.getName(),
          size: createdFile.getSize(),
          directUrl: "https://lh3.googleusercontent.com/d/" + createdFile.getId()
        });
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: "upload_before",
        uploadedCount: uploaded.length,
        files: uploaded
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Upload to "after"
    if (action === "upload_after") {
      var afterFolder = getSubFolder(root, "after");
      if (data.clearFirst !== false) {
        clearFolder(afterFolder);
      }

      var uploadedAfter = [];
      var filesAfter = data.files || [];
      for (var j = 0; j < filesAfter.length; j++) {
        var itemAfter = filesAfter[j];
        var decodedAfter = Utilities.base64Decode(itemAfter.base64);
        var blobAfter = Utilities.newBlob(decodedAfter, itemAfter.mimeType || "application/octet-stream", itemAfter.filename);
        var createdFileAfter = afterFolder.createFile(blobAfter);
        try {
          createdFileAfter.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {}
        uploadedAfter.push({
          id: createdFileAfter.getId(),
          name: createdFileAfter.getName(),
          size: createdFileAfter.getSize(),
          directUrl: "https://lh3.googleusercontent.com/d/" + createdFileAfter.getId()
        });
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: "upload_after",
        uploadedCount: uploadedAfter.length,
        files: uploadedAfter
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Clear "after" subfolder (Invoked after Facebook scheduling is complete)
    if (action === "clean_after") {
      var targetAfter = getSubFolder(root, "after");
      var deletedCount = clearFolder(targetAfter);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: "clean_after",
        message: "After subfolder successfully cleared for next day",
        deletedCount: deletedCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. Clear "before" subfolder
    if (action === "clean_before") {
      var targetBefore = getSubFolder(root, "before");
      var deletedBeforeCount = clearFolder(targetBefore);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: "clean_before",
        deletedCount: deletedBeforeCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Unknown action: " + action
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
