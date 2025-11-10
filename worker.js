
const { createWorker } = require('./lib/queue');
const { exec } = require('child-process-promise');

console.log('Worker process started. Waiting for jobs...');


const worker = createWorker(async (job) => {
  const { command } = job.data;
  console.log(`[Worker] Processing job ${job.id}: ${command}`);

  try {
    const { stdout, stderr } = await exec(command);

    if (stderr) {
      console.warn(`[Worker] Job ${job.id} (stderr): ${stderr}`);
    }
    
    return { stdout, stderr };

  } catch (error) {
    // If 'exec' throws an error (non-zero exit code)
    // BullMQ will catch it and handle the retry logic.
    console.error(`[Worker] Job ${job.id} FAILED: ${error.message}`);
    throw error; // Re-throw to trigger BullMQ's failure/retry
  }
});


worker.on('completed', (job, result) => {
  console.log(`[Worker] Job ${job.id} completed. Output length: ${result.stdout.length}`);
});


worker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job.id} failed after ${job.attemptsMade} attempts.`);
});






