# Queue_CTL_CLI: A CLI Job Queue System

queuectl is a command-line interface for managing a persistent, background job queue. It's built on Node.js and powered by BullMQ and Redis.

It allows you to enqueue shell commands as background jobs, which are then processed by a pool of workers. It's designed to be resilient, supporting automatic retries with exponential backoff and a Dead Letter Queue (DLQ) for jobs that permanently fail.

## Features

- **Persistent Queues**: Jobs are stored in Redis and survive application or server restarts.
- **Worker Pooling**: Run multiple worker processes to handle jobs in parallel.
- **Automatic Retries**: Failed jobs are automatically retried with exponential backoff.
- **Dead Letter Queue (DLQ)**: Jobs that exhaust all retries are moved to a DLQ for inspection.
- **Full CLI Control**: Enqueue, start/stop workers, check status, and manage the DLQ from your terminal.

## Prerequisites

Before you can run queuectl, you must have the following dependencies installed on your system.

### 1. Node.js

This project is built on Node.js. Please install a current LTS version (v18+).

[Download Node.js](https://nodejs.org/)

### 2. Redis Server

BullMQ uses Redis as its database and message broker to store all job data. This is not optional.

You must have the `redis-server` command available on your system.

- **On Fedora**: `sudo dnf install redis`
- **On Ubuntu/Debian**: `sudo apt install redis-server`
- **On macOS (using Homebrew)**: `brew install redis`

### 3. PM2 (Process Manager)

The CLI uses PM2 to manage the background worker processes. This allows queuectl to start, stop, and monitor workers that run in the background.

Install it globally:

```bash
npm install pm2 -g
```

## 🚀 Installation & Setup

1. **Clone the repository:**

```bash
git clone https://github.com/your-username/queuectl.git
cd queuectl
```

2. **Install NPM dependencies:**

```bash
npm install
```

3. **Link the CLI:**

This step uses the `bin` field in `package.json` to create a global `queuectl` command, so you can run it from any directory.

```bash
npm link
```

4. **Create your Environment File:**

The CLI connects to Redis using environment variables. Create a `.env` file in the root of the project.

```bash
touch .env
```

Now, add the following content to the `.env` file. (These defaults match the `redis.conf` file already in the project).

```ini
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

5. **Create the Redis Configuration File:**

For persistence, `queuectl` is designed to run Redis with a specific configuration file. This tells Redis where to save its data.

   a. In the root of your project (the `queuectl` folder), create a file named `redis.conf`.

   b. Copy and paste the following content into it:

```ini
# --- Persistence ---
# Save the DB to a file named...
dbfilename dump.rdb

# Save the file in this specific directory.
# YOU MUST UPDATE THIS PATH
dir /home/jynt/Coding/FLAM/redis-data

# --- General ---
port 6379
logfile "redis.log"
```

   c. **Critical Step**: You must change the `dir` path to match the absolute path to the `redis-data` folder on your own machine.
   
   - Find your path by running `pwd` inside the `redis-data` folder.
   - Update the line: `dir /your/absolute/path/to/queuectl/redis-data`

## 🏃 How to Run

The system requires two separate, long-running processes. You will need 3 terminals open.

### Terminal 1: Start the Redis Server

You must start Redis from the project folder so it uses the included `redis.conf` file. This makes your data persistent.

```bash
# Make sure you are in the queuectl project folder
cd /path/to/queuectl

# Start Redis using the local config
redis-server ./redis.conf
```

### Terminal 2: Start the Workers

In a new terminal (also in the project folder), start your worker pool.

```bash
cd /path/to/queuectl

# Start 3 worker processes in the background
queuectl worker start --count 3
```

### Terminal 3: Use the CLI

Now you can enqueue and manage jobs from any terminal.

```bash
# Enqueue a new job
queuectl enqueue '{"id":"job1", "command":"echo Hello World"}'

# Check the queue status
queuectl status
```

## 📋 Command Reference

Here are all the commands supported by queuectl.

### Manage Workers

**`queuectl worker start --count <n>`**

Starts `<n>` worker processes in the background using PM2. If workers are already running, this will restart them with the new count.

```bash
queuectl worker start --count 4
```

**`queuectl worker stop`**

Gracefully stops and removes all running workers from PM2.

```bash
queuectl worker stop
```

**`queuectl logs`**

Streams the live logs from all running workers directly to your terminal. (Press Ctrl+C to exit).

### Manage Jobs

**`queuectl enqueue <jobJson>`**

Adds a new job to the queue. The JSON string must contain a `command`. You can optionally pass `id` and `max_retries`. If `max_retries` is not provided, the value from `queuectl config` is used.

```bash
# Simple job
queuectl enqueue '{"id":"job-echo", "command":"echo Hello"}'

# Job with a custom retry limit
queuectl enqueue '{"id":"job-fail", "command":"ls /badpath", "max_retries": 2}'
```

**`queuectl status`**

Shows a high-level summary of all job states (Pending, Processing, Completed, Failed, etc.).

**`queuectl list --state <state>`**

Lists all jobs in a specific state.

**States**: `pending`, `processing` (active), `completed`, `dead` (failed), `retry` (delayed)

```bash
queuectl list --state completed
queuectl list --state dead
```

**`queuectl job status <jobId>`**

Checks the current state and detailed info for a single job, including timestamps and results.

```bash
queuectl job status job-echo
```

### Manage the Dead Letter Queue (DLQ)

The "DLQ" is the queue for dead (or failed) jobs.

**`queuectl dlq list`**

Lists all jobs that have permanently failed (exhausted all retries).

**`queuectl dlq retry <jobId>`**

Moves a specific job from the DLQ back into the pending queue to be retried by a worker.

### Manage Configuration

**`queuectl config set <key> <value>`**

Saves a setting to the `.queuectl.config.json` file. This is currently used to set the default `maxRetries` for new jobs.

```bash
queuectl config set max-retries 5
```

**`queuectl config list`**

Shows all current settings from the `.queuectl.config.json` file.
