# fitbit-delivert
Fitbit Delivert is an attempt to make Fitbit OS watch-to-companion and companion-to-watch communications more reliable and customizable.  Fitbit Delivert allows you to control how many payloads you store, adjust the rate of payload transmission, and utilize a sliding-window approach to discarding files. It also offers out-of-the-box default options that have been tweaked based off certain experiences of mine as a professional Fitbit OS developer. 

Fitbit Delivert does not guarantee that a file will be transmitted or that it will arrive on the companion app in the order it was sent in. However, file transmission order should *almost always* be correct with the default file transmission frequency. This package currently prioritizes throughput and utilizes certain hacky approaches to attempt to keep the connection open. There is uncertainty around these approaches but with limited dev support I am forced to make guesses and assumptions. The single greatest challenge with Fitbit is transferring data without running into syncing or connection ("clogging") issues, and this package is unlikely to fully resolve that as it's largely beyond my control. However, any improvement is some improvement.  

Fitbit Delivert wraps the File-Transfer API and is designed to work with existing implementations, mostly. Delivert will destroy files if they sit in the outbox queue in a way that blocks it. You should implement a file transfer approach similar to the example unless you're intimately familiar with Delivert.

NOTE: Delivert does not utilize file storage on the companion yet (due to lack of time) so the sophicated payload management on the watch will not be there. There are no retries for companion-to-watch beyond what the File-Transfer API provides.

## :warning: Warning :warning:

You cannot use this package directly through NPM. You will get an error:

> Unhandled exception: Error: failed to pre-parse snapshot

This error appears related to [loading too much](https://community.fitbit.com/t5/SDK-Development/Unhandled-Error-failed-to-pre-parse-snapshot/td-p/2947498) from the NPM package initially but it's beyond my understanding. You can install through NPM or clone via GitHub but either way you'll need to move the two relevant files. Move **delivert-watch.js** into your *app* folder somewhere and **delivert-companion.js** into your *companion* folder somewhere. This does defeat a lot of the advantages and purpose of having NPM but appears beyond my control presently. Using this package will require diligence to maintain and update.

This package has also been tested only on Sense/Versa 3 watch faces and not on apps yet. Please feel free to report issues as they arise. This project continues to be a work-in-progress as time and needs permit. 

## Usage
You need to have the [Fitbit CLI](https://dev.fitbit.com/build/guides/command-line-interface/) and NPM.
#### Installation
```
npm i fitbit-delivert
```
Then follow the instructions in Warning above. 

#### Device Example
```javascript
import delivert from "./delivert-watch"; 

delivert.options({PAYLOAD_LIMIT: 100, WATCH_RESET_ENABLED: false})

// Capture accelerometer data
const accelData = new Float32Array(30);
...
delivert.send({name: `file${count}`, accelData: accelData, timeSent: Date.now()});

// Get files from companion
function processAllFiles() {
	let fileName;
	while (fileName = inbox.nextFile()) {
		if (existsSync(fileName)) {
			const accelBuffer = readFileSync(fileName, "cbor");
			unlinkSync(fileName);
			const data = new Float32Array(accelBuffer);
		};
	};
};
```
#### Companion Example
```javascript
import delivert from "./delivert-companion";  

delivert.options({EXIT_EVERY_MINUTES: 10});

// Get files from watch
async function processAllFiles() {
	let file;
	while ((file = await inbox.pop())) {
		const payload = await file.cbor();
		payload.accelData = new Float32Array(payload.accelData);
		// Send the accelerometer readings without name/stamp back to the watch
		delivert.send(payload.accelData.buffer);
		sendDataToServer(payload);
	};
};
```
## API
#### `delivert.send(payload)`
Send a message from the watch to the companion or vice versa. Payload is CBOR-encoded. Returns void.
#### `delivert.options(config)`
Set the watch or companion config. Setting options must be done within the appropriate app or companion folder. Returns void.
##### `config` 
An object with unique fields for both watch and companion.

### Device Config 

##### `config.PAYLOAD_LIMIT` **integer**
Max number of Delivert outgoing watch payloads to store in the file system. Default is 330.
##### `config.FILE_TRANSMISSION_FREQUENCY` **integer**
Frequency in milliseconds that the watch will transmit payloads when connection is open and working properly. Default is 2000.
##### `config.MAX_OFFSET` **integer**
Payloads are numbered sequentially e.g. delivert_watch_337 is followed by delivert_watch_338. This is a cap on how high that addressing number can go before wiping all Delivert payloads entirely. This is important because in a sliding window earlier payloads are deleted first and there may be some advantage to overwriting if a deletion fails. Default is 1440.
##### `config.MAX_PAYLOAD_ERROR` **integer**
An emergency safeguard if the payload limit fails to enforce a max quantity on account of an OS issue (I've had this happen a few times with over 330 payload count). Default is 10.
##### `config.AUTO_RESET_MINUTES` **integer**
How often the watch face should reboot, in minutes. This shouldn't be used on an app, only a clock face. Default is 5.
##### `config.WATCH_RESET_ENABLED` **boolean**
Whether or not the watch face reboots to attempt re-enabling connection. Set to false if using an app. Default is true.

### Companion Config 

##### `config.AWAKEN_ENABLED` **boolean**
Whether or not to set a wakeInterval on the companion. Default is true.
##### `config.AWAKEN_EVERY_MINUTES` **integer**
Set the wakeInterval to be every X minutes. Default is 1.
##### `config.EXIT_ENABLED` **boolean**
Set the companion to yield. Default is true.
##### `config.EXIT_EVERY_MINUTES` **integer**
Set the yield to be every X minutes. Default is 5.
