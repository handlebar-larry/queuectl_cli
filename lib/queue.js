
const { Queue, Worker, Job } = require('bullmq');
require('dotenv').config();

const QUEUE_NAME = 'cli-jobs';

const connection = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
};



function getQueue() {
  return new Queue(QUEUE_NAME, { connection });
}


function createWorker(processor) {
  return new Worker(QUEUE_NAME, processor, { connection });
}





module.exports = { getQueue, createWorker };


