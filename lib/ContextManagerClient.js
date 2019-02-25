"use strict";

var zmq = require('zeromq');
var uuidv4 = require('uuid/v4');

const RLOCK = 0;
const WLOCK = 1;
const LOCK_UNLOCK = 2;

const REQ_ST_WAITING_LOCK_RESPONSE = 0;
const REQ_ST_WAITING_UNLOCK_RESPONSE = 1;
const REQ_ST_WAITING_LOCK_UNLOCK_RESPONSE = 2;
const REQ_ST_PROCESSING = 3;

function timeoutRequest(id, map) {
  console.log("request %s timed out", id);
  if (map.hasOwnProperty(id)) {
    let contextEntry = map[id];
    delete map[id];
    contextEntry.reject('timeout');
  }
}

module.exports = class ContextManagerClient {
  /**
   * 
   * @param {*} contextManagerHost The context manager address
   * @param {*} contextManagerPort The context manager port
   * @param {*} responseTimeout Response Timeout. How long the client should wait
   * for a response (to save/get a context). This time value is in ms.
   */
  constructor(contextManagerHost, contextManagerPort, responseTimeout) {
    this.contextMap = {};
    this.contextResponseTimeout = responseTimeout; // time in ms
    this.contextSocket = null;
    this.contextManagerHost = contextManagerHost;
    this.contextManagerPort = contextManagerPort;
  }  

  init() {
    this.contextSocket = zmq.socket('dealer');

    this.contextSocket.on("message", (reply) => {
      console.log("Received reply [%s]", reply.toString());
      let data = JSON.parse(reply);
    
      if (!this.contextMap.hasOwnProperty(data.request_id)) {
        console.log('request %s was expired', data.request_id);
        return;
      }
    
      let contextEntry = this.contextMap[data.request_id];
      clearTimeout(contextEntry.timer);
    
      switch (contextEntry.state) {
        case REQ_ST_WAITING_LOCK_RESPONSE:
          if (data.result === 'ok') {
            console.log('locked');
            this.contextMap[data.request_id].state = REQ_ST_PROCESSING;
            let context = {};
            if (data.context_content.length !== 0) {
              context = JSON.parse(data.context_content);
            }
            contextEntry.resolve([data.request_id, context]);
          } else {
            console.log('lock failed, reason: %s', data.reason);
            delete this.contextMap[data.request_id];
            contextEntry.reject('internal error');
          }
        break;
        case REQ_ST_WAITING_UNLOCK_RESPONSE:
          delete this.contextMap[data.request_id];
          if (data.result === 'ok') {
            console.log('unlocked');
            contextEntry.resolve();
          } else {
            console.log('unlock failed, reason: %s', data.reason);
            contextEntry.reject();
          }
        break;
        case REQ_ST_WAITING_LOCK_UNLOCK_RESPONSE:
          delete this.contextMap[data.request_id];
          if (data.result === 'ok') {
            console.log('get... ok');
            let context = {};
            if (data.context_content.length !== 0) {
              context = JSON.parse(data.context_content);
            }
            contextEntry.resolve(context);
          } else {
            console.log('get failed, reason: %s', data.reason);
            contextEntry.reject('internal error');
          }
        break;
        default:
          console.log('invalid state: %s', contextEntry.state);
          delete this.contextMap[data.request_id];
          contextEntry.reject('internal error');
        break;
      }      
    }); // on message

    this.contextSocket.connect("tcp://" + this.contextManagerHost + ":" + this.contextManagerPort);
    
    process.on('SIGINT', () => {
      this.contextSocket.close();
    });

    console.log('Context Manager Client initialized');
  }

  unlockContext(contextId, shouldSave, contextContext = undefined) {
    console.log('requesting to unlock context %s', contextId);
    return new Promise ((resolve, reject) => {
      if (!this.contextMap.hasOwnProperty(contextId)) {
        console.log('Context not found: %s', contextId);
        reject('context not found');
        return;
      }
      let contextEntry = this.contextMap[contextId];
      if (contextEntry.state !== REQ_ST_PROCESSING) {
        console.log('Calling unlock, but the request is not processing.' +
          ' User miscall the method?');
        reject('invalid state');
        return;
      }
      if ( (contextEntry.lockMode === RLOCK) && (shouldSave) ) {
        console.log('trying to modify context\'s content while holding a read lock');
        reject('trying to modify context\'s content while holding a read lock');
        return;
      }

      let request = {
        command: "unlock",
        data: {
          request_id: contextId,          
        }
      };

      if (shouldSave) {
        request.command = "save_and_unlock";
        request.data.context_content = JSON.stringify(contextContext);
        console.log('Context content: ', request.data.context_content);
      }

      let timer = setTimeout(timeoutRequest, this.contextResponseTimeout,
        contextId, this.contextMap);

      contextEntry.timer = timer;
      contextEntry.resolve = resolve;
      contextEntry.reject = reject;
      contextEntry.state = REQ_ST_WAITING_UNLOCK_RESPONSE;

      this.contextMap[contextId] = contextEntry;      

      this.contextSocket.send(JSON.stringify(request));
    });
  }

  lockAndGetContext(contextName, lockMode) {
    return new Promise ((resolve, reject) => {
      let requestId = uuidv4().toString();
      let request = {
        command: "rlock_and_get",
        data: {
          context_name: contextName,
          request_id: requestId
        }
      }      

      let timer = setTimeout(timeoutRequest, this.contextResponseTimeout,
        requestId, this.contextMap);

      let contextObj = {
        timer: timer,
        lockMode: lockMode,
        state: REQ_ST_WAITING_LOCK_RESPONSE,
        resolve: resolve,
        reject: reject
      };

      if (lockMode === WLOCK) {
        request.command = "wlock_and_get";
      } else if (lockMode === LOCK_UNLOCK) {
        request.command = "lock_get_and_unlock";
        contextObj.state = REQ_ST_WAITING_LOCK_UNLOCK_RESPONSE;
      }

      this.contextMap[requestId] = contextObj;

      console.log('requesting to retrieve context: %s (%s)', contextName, requestId);
      this.contextSocket.send(JSON.stringify(request));
    }); 
  }
}
