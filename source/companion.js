import { outbox } from "file-transfer";
import { encode } from "cbor";
import { me } from "companion";
import { settingsStorage } from "settings";
import { peerSocket } from "messaging";

// Experimentially determined limit before files won't queue
// Note: technically has edge cases where it does not act as a queue
let filesInTransit = [undefined, undefined, undefined, undefined, undefined, undefined]

// setTimeout IDs
let awakenID;
let exitID;

// Default delivert companion config
let config = {
    AWAKEN_ENABLED: true,
    AWAKEN_EVERY_MINUTES: 1,
    EXIT_ENABLED: true,
    EXIT_EVERY_MINUTES: 5
};

// Set wake interval to 10 minutes and a custom awaken function to a config-defined number of minutes if awaken functionality is enabled
if (config.AWAKEN_ENABLED) {
    me.wakeInterval = 600000; 
    me.addEventListener("wakeinterval", wakeUp);
    awakenID = setTimeout(awaken, 60000*config.AWAKEN_EVERY_MINUTES);
};

// Exit the app after a config-defined number of minutes if exit functionality is enabled
if (config.EXIT_ENABLED) {
    exitID = setTimeout(exit, 60000*config.EXIT_EVERY_MINUTES);
};

// setTimeout loop that hopefully gets around some of the disconnection issues in Fitbit OS
function awaken() {
  wakeUp();
  awakenID = setTimeout(awaken, 60000*config.AWAKEN_EVERY_MINUTES);
};

// Yield the companion to the OS temporarily
function exit() {
  me.yield();
};

// Had previous experience where settingsStorage called twice awakened the companion; could be useless but worth a try
function wakeUp() {
  settingsStorage.setItem("wake", "up");
  settingsStorage.setItem("wake", "up");
  try {
    peerSocket.send("ping");
  } catch {
    console.log("peer not open");
  }
}; 

// Set the delivert companion config; overwrite default config
function setConfig(userConfig = {}) {
    config = {...config, ...userConfig};
    clearTimeout(awakenID);
    me.wakeInterval = undefined;
    if (config.AWAKEN_ENABLED) {
        me.wakeInterval = 600000; 
        me.addEventListener("wakeinterval", wakeUp);
        awakenID = setTimeout(awaken, 60000*config.AWAKEN_EVERY_MINUTES);
    }
    clearTimeout(exitID);
    if (config.EXIT_ENABLED) {
        exitID = setTimeout(exit, 60000*config.EXIT_EVERY_MINUTES);
    }
};

// Send delivert companion payloads to watch as a buffer; connection NOT assumed
function sendDataToWatch(data) {
    const buffer = encode(data);
    // Delete unusable file transfer objects in queue
    filesInTransit.forEach((ft, idx) => {
        if (ft && (
               ft.readyState == "cancelled" 
            || ft.readyState == "transferred" 
            || ft.readyState == "error"
        )) { filesInTransit[idx] = undefined; }
    });
    // Find the first free array element to store the file transfer object
    let firstEmptyArrElemIdx = filesInTransit.indexOf(undefined);
    // Cancel all transfers if too many files queued, determined by no empty array space
    if (firstEmptyArrElemIdx == -1) {
        // Cancel existing file transfers
        filesInTransit.forEach(ft => ft && ft.readyState && ft.cancel());
        // All arr elements are made undefined
        for (let i = 0; i < filesInTransit.length; i++) { filesInTransit[i] = undefined; }
        // First arr elem is now known to be free, without having to recompute anything
        firstEmptyArrElemIdx = 0;
    };
    // Placeholder until promise finished and 'then' block executes
    filesInTransit[firstEmptyArrElemIdx] = "placeholder";
    // Queue file for companion. Indexing should force an overwriting of existing payloads, even if cancelling fails
    outbox.enqueue(`delivert_companion_${firstEmptyArrElemIdx}`, buffer)
    .then(ft => {
        filesInTransit[firstEmptyArrElemIdx] = ft;
    }).catch(err => {
        // TODO: add file-based logging 
    });     
  };

export const delivert = {
    send: sendDataToWatch,
    options: setConfig
};