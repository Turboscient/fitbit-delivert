import { outbox } from "file-transfer";
import { listDirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { me } from "appbit";
import { peerSocket } from "messaging";
import { encode, decode } from "cbor";

// Clockface should continue indefinitely
me.appTimeoutEnabled = false;

// Store the file queue before app fully unloads
me.onunload = writeFileQueue;

// Experimentially determined limit of 6 before files won't queue
// Note: technically has edge cases where it does not act as a queue
const filesInTransit = [undefined, undefined, undefined, undefined, undefined, undefined]

// Get the file queue when app loads
let queue = getFileQueue();

// Default delivert configuration options on the watch
let config = {
    PAYLOAD_LIMIT: 330,  
    FILE_TRANSMISSION_FREQUENCY: 2000,
    MAX_OFFSET: 1440,
    MAX_PAYLOAD_ERROR: 10,
    AUTO_RESET_MINUTES: 5,
    WATCH_RESET_ENABLED: true
};

// Empty the file queue and store it
function setQueueAsEmpty() {
    queue = [];
    writeFileSync("file-queue", encode(queue), "cbor");
};

// Store the file queue 
function writeFileQueue() {
    writeFileSync("file-queue", encode(queue), "cbor");
};

// Insert new address into the file queue; trim queue and remove associated file if necessary
function insertFileQueue(latestAddress) {
    if (queue.length > config.PAYLOAD_LIMIT) {
        const oldestAddress = queue.shift();
        const fileToRemove = `delivert_watch_${oldestAddress}`;
        unlinkSync(fileToRemove);
    }
    queue.push(latestAddress);
};

// Retrieve file queue, with default
function getFileQueue() {
    if (!existsSync("file-queue")) {
        setQueueAsEmpty();
    };
    return decode(readFileSync("file-queue", "cbor"));
};

// Manage the file queue by reading the most recent stored queue, adding to it, and rewriting
function updateQueue(latestAddress) {
    getFileQueue();
    // Store up to PAYLOAD_LIMIT entries in a queue
    insertFileQueue(latestAddress);
    writeFileQueue();
};

// Get the user's configuration options for delivert, if they exist
function getConfig() {
    if (!existsSync("delivert_config")) return;
    config = decode(readFileSync("delivert_config", "cbor"));
    clearInterval(batchIntervalID);
    clearInterval(autoResetIntervalID);
    batchIntervalID = setInterval(loadPayloadIntoMemoryIfConnected, config.FILE_TRANSMISSION_FREQUENCY);
    autoResetIntervalID = setInterval(rebootWatchFace, 60000*config.AUTO_RESET_MINUTES);
};

// User can set configuration options for delivert, aliased as 'options'
function setConfig(userConfig = {}) {
    config = {...config, ...userConfig};
    writeFileSync("delivert_config", encode(config), "cbor");
    getConfig();
};

// If being used by a watch face app, reboot. Should not be enabled if an app because it will exit without reboot.
function rebootWatchFace() {
    if (config.WATCH_RESET_ENABLED) me.exit();
};

// Generate a 4-digit address for the delivert file
function createSequentialAddress(idx) {
    //https://stackoverflow.com/questions/1127905/how-can-i-format-an-integer-to-a-specific-length-in-javascript
    return ("000" + idx).slice(-4);
};

// Empty the delivert file queue and destroy delivert files intended to be sent to the companion
function deleteAllOutboundDelivertWatchPayloads() {
    const listDir = listDirSync("/private/data");
    let dirIter;
    setQueueAsEmpty();
    while((dirIter = listDir.next()) && !dirIter.done) {
        if (dirIter.value.match("delivert_watch_")) {            
            unlinkSync(dirIter.value);
        };
    };
};

// Destroy all delivert companion files that have been received by the watch
function deleteAllDelivertCompanionFilesStoredOnWatch() {
    const listDir = listDirSync("/private/data");
    let dirIter;
    while((dirIter = listDir.next()) && !dirIter.done) {
        if (dirIter.value.match("delivert_companion_")) unlinkSync(dirIter.value);
    };
};

// Check the number of delivert payloads to be sent and the max address
function getOutboundDelivertWatchPayloadDetails() {
    const listDir = listDirSync("/private/data");
    let payloadCount = 0;
    let dirIter;
    let maxOffset = 0;
    while((dirIter = listDir.next()) && !dirIter.done) {
        if (dirIter.value.match("delivert_watch_")) {
            maxOffset = Math.max(dirIter.value.slice(15), maxOffset);
            payloadCount += 1;
        }
    };
    return {payloadCount: payloadCount, payloadOffset: maxOffset};
};

// Send payload data to the companion if there is a Bluetooth connection
function loadDelivertWatchPayloadIntoMemoryIfConnected() {
    if (peerSocket.readyState === peerSocket.OPEN) {   
        const address = queue.shift();
        if (address === undefined) return;
        const fileName = `delivert_watch_${address}`;
        if (existsSync(fileName)) {
            const buffer = readFileSync(fileName, "cbor");
            sendDataToCompanion(buffer);
            unlinkSync(fileName);
        };  
        writeFileQueue();
    };
};

// Connection assumed upon by this point; send delivert watch payloads to companion as a buffer
function sendDataToCompanion(buffer) {
    // Delete unusable file transfer objects in queue
    filesInTransit.forEach((ft, idx) => {
        if (ft && (
               ft.readyState === "cancelled" 
            || ft.readyState === "transferred" 
            || ft.readyState === "error"
        )) { filesInTransit[idx] = undefined; }
    });

    // Find the first free array element to store the file transfer object
    let firstEmptyArrElemIdx = filesInTransit.indexOf(undefined);
    // Cancel all transfers if max files queued, determined by no empty array space
    if (firstEmptyArrElemIdx === -1) {
        // Cancel existing file transfers
        filesInTransit.forEach(ft => ft && ft.readyState && ft.cancel());
        // All arr elements are made undefined
        for (let i = 0; i < filesInTransit.length; i++) { filesInTransit[i] = undefined; }
        // First arr elem is now known to be free, without having to recompute anything
        firstEmptyArrElemIdx = 0;
    };
    // Placeholder until promise finished and 'then' block executes
    filesInTransit[firstEmptyArrElemIdx] = "placeholder";
    // Queue file for companion. Finite namespace should force an overwriting of existing payloads, even if cancelling fails
    outbox.enqueue(`delivert_watch_${firstEmptyArrElemIdx}`, buffer)
    .then(ft => {
        filesInTransit[firstEmptyArrElemIdx] = ft;
    }).catch(err => {
        // TODO: add file-based logging 
    });     
};

// Store, manage, or send data to companion, depending on the application and connection state
function transmissionManager(data) {
    const buffer = encode(data);
    const {payloadCount, payloadOffset} = getOutboundDelivertWatchPayloadDetails();
    if ((peerSocket.readyState === peerSocket.CLOSED || payloadCount > 0)) {
        // Max of four-digit offset and safeguard if payloads exceed limit
        if (payloadOffset <= config.MAX_OFFSET && payloadCount <= config.PAYLOAD_LIMIT + config.MAX_PAYLOAD_ERROR) {
            // Ensures a unique address in the file system
            const address = createSequentialAddress(payloadOffset+1);
            const payloadName = `delivert_watch_${address}`;
            // Write the buffer to the address as a file, overwrites if exists
            writeFileSync(payloadName, buffer, "cbor");
            // ensure the queue is aware of the latest payload
            updateQueue(address);
        } else {
            deleteAllOutboundDelivertWatchPayloads();
        };        
        return;
    };
    sendDataToCompanion(buffer);
};

let autoResetIntervalID = setInterval(rebootWatchFace, 60000*config.AUTO_RESET_MINUTES);
let batchIntervalID = setInterval(loadDelivertWatchPayloadIntoMemoryIfConnected, config.FILE_TRANSMISSION_FREQUENCY);
getConfig();
deleteAllDelivertCompanionFilesStoredOnWatch();

const delivert = {
    send: transmissionManager,
    options: setConfig
};

export default delivert;