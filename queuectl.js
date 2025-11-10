#!/usr/bin/env node

const { Command } = require('commander');
const { getQueue } = require('./lib/queue');
const { Job } = require('bullmq');
const shell = require('shelljs');
const path = require('path');
const fs = require('fs');
const { config } = require('dotenv');


const CONFIG_FILE = '.queuectl.config.json'; // Config file in our project dir
const DEFAULT_CONFIG = { maxRetries: 3 };

// Helper function to load config
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch (e) {
    console.warn('Warning: .queuectl.config.json is corrupt. Using defaults.');
    return DEFAULT_CONFIG;
  }
}

// Helper function to save config
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Error saving config:', e.message);
  }
}




const program = new Command();

program.name('queuectl').description('A CLI for the BullMQ job queue system');



// A much better design
program
  .command('enqueue')
  .description('Add a new job to the queue')
  .option('-i, --id <id>', 'Job ID')
  .option('-c, --command <command>', 'Shell command to run')
  .option('-r, --retries <number>', 'Max retries')
  .action(async (options) => {
    const queue = getQueue();
    const config = loadConfig();
    try {
      const jobId = options.id || `job-${Date.now()}`;
      const command = options.command;
      const maxRetries = options.retries || config.maxRetries;

      if (!command) {
        throw new Error('A --command is required.');
      }

      await queue.add('shell-command', 
        { command: command },
        {
          jobId: jobId,
          attempts: maxRetries,
          // ... etc
        }
      );
      console.log(`Job enqueued with ID: ${jobId}`);
    } catch (e) {
      console.error(`Error enqueuing job: ${e.message}`);
    }
    await queue.close();
  });




program
  .command('status')
  .description('Show summary of all job states')
  .action(async () => {
    const queue = getQueue();
    const counts = await queue.getJobCounts();
    console.log('--- Job Queue Status ---');
    console.log(`Pending (Waiting): ${counts.waiting}`);
    console.log(`Processing (Active): ${counts.active}`);
    console.log(`Retry (Delayed):   ${counts.delayed}`);
    console.log(`Completed:         ${counts.completed}`);
    console.log(`Dead (Failed):     ${counts.failed}`); // This is your DLQ
    await queue.close();
  });



program
  .command('list')
  .description('List jobs by state')
  .option('--state <state>', 'State (pending, processing, completed, dead, retry)', 'pending')
  .action(async (options) => {
    const queue = getQueue();
    let jobState;
    let stateName = options.state;

    // Map your states to BullMQ states
    switch (stateName) {
      case 'processing': jobState = 'active'; break;
      case 'completed': jobState = 'completed'; break;
      case 'dead': jobState = 'failed'; break; // Your DLQ
      case 'retry': jobState = 'delayed'; break;
      case 'pending':
      default:
        jobState = 'waiting';
        stateName = 'pending (waiting)';
    }

    const jobs = await queue.getJobs(jobState, 0, 100);
    console.log(`--- Showing jobs in state: ${stateName} ---`);
    if (jobs.length === 0) {
      console.log('No jobs found.');
    } else {
      jobs.forEach(job => {
        const createdDate = new Date(job.timestamp).toLocaleString();
        console.log(`- ID: ${job.id} | Created: ${createdDate} | Cmd: ${job.data.command} | Attempts: ${job.attemptsMade}`);
      });
    }
    await queue.close();
  });



// --- Job Status Command ---
program
  .command('job')
  .command('status <jobId>')
  .description('Check the current state of a specific job')
  .action(async (jobId) => {
    const queue = getQueue();
    try {
      const job = await Job.fromId(queue, jobId);
      if (!job) {
        // ... (error handling) ...
        return;
      }

      const state = await job.getState();
      console.log(`--- Job Status: ${jobId} ---`);
      console.log(`State: ${state}`);
      console.log(`Command: ${job.data.command}`);
      console.log(`Attempts Made: ${job.attemptsMade} / ${job.opts.attempts}`);
      
      // --- ADD THESE LINES ---
      console.log(`Created At:     ${new Date(job.timestamp).toLocaleString()}`);
      if (job.processedOn) {
        console.log(`Processing Sat: ${new Date(job.processedOn).toLocaleString()}`);
      }
      if (job.finishedOn) {
        console.log(`Last Updated:   ${new Date(job.finishedOn).toLocaleString()}`);
      }
      // --- END OF ADDED LINES ---

      if (state === 'failed') {
        console.log(`Failed Reason: ${job.failedReason}`);
      }
      if (state === 'completed') {
        console.log(`Result:`, job.returnvalue);
      }

    } catch (e) {
      // ... (error handling) ...
    }
    await queue.close();
  });

  

const dlq = program
  .command('dlq')
  .description('Manage the Dead Letter Queue (failed jobs)');



dlq
  .command('list')
  .description('Manage the Dead Letter Queue (failed jobs)')
  .action(async () => {
    const queue = getQueue();
    const jobs = await queue.getJobs('failed', 0, 100); // 'failed' is the DLQ
    console.log(`--- Dead Letter Queue (Failed Jobs) ---`);
    if (jobs.length === 0) {
        console.log('DLQ is empty.');
    } else {
        jobs.forEach(job => {
            console.log(`- ID: ${job.id} | Command: ${job.data.command} | Reason: ${job.failedReason}`);
        });
    }
    await queue.close();
  });


dlq
  .command('retry <jobId>')
  .description('Retry a job from the DLQ')
  .action(async (jobId) => {
    const queue = getQueue(); // 1. Get a fresh queue connection
    try {
      // 2. Fetch the job using the *local* queue instance
      const job = await Job.fromId(queue, jobId); 

      if (!job) {
        console.error(`Error: Job ${jobId} not found.`);
        return;
      }
      
      const state = await job.getState();
      if (state !== 'failed') {
        console.error(`Error: Job ${jobId} is not in the 'failed' (DLQ) state. It is: ${state}`);
        return;
      }

      // 3. Retry the job (connection is still open)
      await job.retry();
      console.log(`Job ${jobId} has been moved to 'waiting' for a retry.`);

    } catch (e) {
      console.error(`Error retrying job: ${e.message}`);
    } finally {
      // 4. Ensure the connection closes
      await queue.close();
    }
  });




const worker = program
  .command('worker')
  .description('Manage worker processes');


worker
  .command('start')
  .description('Start worker processes in the background')
  .option('--count <n>', 'Number of worker instances', 1)
  .action((options) => {
    // Check if pm2 is installed
    if (!shell.which('pm2')) {
      console.error('Error: PM2 is not installed.');
      console.log('Please install it with: npm install pm2 -g');
      return;
    }
    
    const count = options.count;
    const workerFile = path.join(__dirname, 'worker.js') // The name of your worker script
    const appName = 'queue-workers'; // A name for PM2 to manage

    console.log(`Starting ${count} worker(s) in the background...`);
    
    // This runs the shell command:
    // pm2 start worker.js -i <count> --name queue-workers
    const result = shell.exec(
      `pm2 start ${workerFile} -i ${count} --name ${appName}`, 
      { silent: true }
    );

    if (result.code !== 0) {
      console.error('Error starting workers:');
      console.error(result.stderr);
    } else {
      console.log('Workers started successfully via PM2.');
      console.log('Run "pm2 list" to see them.');
    }
  });





worker
  .command('stop')
  .description('Stop all running worker processes')
  .action(() => {
    if (!shell.which('pm2')) {
      console.error('Error: PM2 is not installed.');
      return;
    }

    const appName = 'queue-workers';
    console.log(`Stopping and deleting all "${appName}" workers...`);

    // This runs: pm2 stop queue-workers && pm2 delete queue-workers
    const stopResult = shell.exec(`pm2 stop ${appName}`, { silent: true });
    const deleteResult = shell.exec(`pm2 delete ${appName}`, { silent: true });

    if (stopResult.code !== 0 && !stopResult.stderr.includes('not found')) {
      console.error('Error stopping workers:');
      console.error(stopResult.stderr);
    } else if (deleteResult.code !== 0 && !deleteResult.stderr.includes('not found')) {
      console.error('Error deleting workers:');
      console.error(deleteResult.stderr);
    } else {
      console.log('All workers stopped and removed from PM2.');
    }
  });







// --- Config Commands ---

const configsetup = program.command('config');

configsetup
  .command('set <key> <value>')
  .description('Set a configuration value (e.g., maxRetries)')
  .action((key, value) => {
    const config = loadConfig();
    
    // Convert to number if it looks like one
    const numValue = Number(value);
    config[key] = isNaN(numValue) ? value : numValue;

    saveConfig(config);
    console.log(`Config updated: ${key} = ${config[key]}`);
  });


configsetup
  .command('list')
  .description('List all current configurations')
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });



(async () => {
  await program.parseAsync(process.argv);
})();

