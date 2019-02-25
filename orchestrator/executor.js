"use strict";

var amqp = require('./amqp');
var config = require('./config');
var nodes = require('./nodeManager').Manager;

module.exports = class Executor {
    constructor(contextHandler) {
        console.log('[executor] initializing ...');
        this.hop = this.hop.bind(this);
        this.producer = new amqp.AMQPProducer(config.amqp.queue, config.amqp.url, 2);
        this.consumer = new amqp.AMQPConsumer(config.amqp.queue, this.hop, config.amqp.url, 2);
        this.contextHandler = contextHandler;
    }

    init() {
        return this.producer
            .connect()
            .then(() => {
                this.consumer.connect();
            });
    }

    hop(data, ack) {
        let event;
        try {
            event = JSON.parse(data);
        } catch (error) {
            console.error("[amqp] Received event is not valid JSON. Ignoring");
            return ack();
        }

        const at = event.flow.nodeMap[event.hop];
        // sanity check on received hop
        if (!at.hasOwnProperty('type')) {
            console.error(`[executor] Node execution failed. Missing node type. Aborting flow ${event.flow.id}.`);
            // TODO notify alarmManager
            return ack();
        }

        console.log(`[executor] will handle node ${at.type}`);
        let handler = nodes.getNode(at.type, event.metadata.tenant);
        if (handler) {
            let metadata = {
                flowId: event.flow.id,
                tenant: event.metadata.tenant,
                originatorDeviceId: event.metadata.originator
            }
            handler.handleMessage(at, event.message, metadata, this.contextHandler)
                .then((result) => {
                    console.log(`[executor] hop (${at.type}) result: ${JSON.stringify(result)}`);
                    for (let output = 0; output < at.wires.length; output++) {
                        let newEvent = result[output];
                        if (newEvent) {
                            for (let hop of at.wires[output]) {
                                // event that are being processed must use
                                // the maximum priority, in this way new
                                // coming event will need to wait until
                                // the previous being processed
                                this.producer.sendMessage(JSON.stringify({
                                    hop: hop,
                                    message: newEvent,
                                    flow: event.flow,
                                    metadata: event.metadata
                                }), 1);
                            }
                        }
                    }
                    return ack();
                }).catch( (error) => {
                    console.error(`[executor] Node execution failed. ${error}. Aborting flow ${event.flow.id}.`);
                    // TODO notify alarmManager
                    return ack();
                });
        } else {
            console.error(`[executor] Unknown node ${at.type} detected. Igoring.`);
            return ack();
        }
    }
};
