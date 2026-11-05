const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

/**
 * Creates a thin SQS adapter (long polling receive + delete).
 * The underlying client is injectable so tests run without live AWS.
 *
 * @param {object} options - Adapter dependencies.
 * @param {string} options.region - AWS region.
 * @param {object} [options.client] - Prebuilt SQS client (tests).
 * @returns {object} SQS adapter.
 */
function createSqsAdapter({ region, client = new SQSClient({ region }) } = {}) {
  if (!region) throw new Error('createSqsAdapter requires a region');

  return {
    /**
     * Long-polls one queue for a batch of messages.
     *
     * @param {string} queueUrl - Queue URL.
     * @param {object} [options] - Receive options.
     * @param {number} [options.maxMessages] - Max messages per poll (1-10).
     * @param {number} [options.waitTimeSeconds] - Long-poll duration (default 20).
     * @returns {Promise<object[]>} Messages ({messageId, receiptHandle, body, attributes}).
     */
    receive: async (queueUrl, { maxMessages = 10, waitTimeSeconds = 20 } = {}) => {
      const output = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          MessageAttributeNames: ['All'],
          AttributeNames: ['ApproximateReceiveCount']
        })
      );
      return (output.Messages || []).map((message) => ({
        messageId: message.MessageId,
        receiptHandle: message.ReceiptHandle,
        body: message.Body,
        attributes: message.Attributes || {},
        messageAttributes: message.MessageAttributes || {}
      }));
    },

    /**
     * Deletes a processed message from its queue.
     *
     * @param {string} queueUrl - Queue URL.
     * @param {string} receiptHandle - Receipt handle of the message.
     * @returns {Promise<void>}
     */
    delete: async (queueUrl, receiptHandle) => {
      await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    }
  };
}

module.exports = { createSqsAdapter };
