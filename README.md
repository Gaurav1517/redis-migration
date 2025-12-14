# Redis VM Migration Practice App (GCP / Docker)

This is a **small Node.js + Redis web app** designed so you can practice:

- Running a web app on **VM1**
- Running Redis on **VM2**
- Migrating Redis to **VM3** with **minimal downtime**, using almost the same steps as your production scenario.

---

## 1. App Overview

The app exposes simple HTTP endpoints:

- `GET /`  
  Returns basic info and links.

- `GET /health`  
  Health check for the app itself.

- `GET /redis-health`  
  Checks Redis connection.

- `POST /set` with JSON body `{ "key": "foo", "value": "bar" }`  
  Sets a key in Redis.

- `GET /get?key=foo`  
  Gets `foo` from Redis.

- `POST /incr` with JSON body `{ "key": "counter" }`  
  Increments an integer key.

The app uses these environment variables:

- `REDIS_HOST` (e.g. `10.0.0.5` or `34.x.x.x`)
- `REDIS_PORT` (default: `6379`)
- `REDIS_PASSWORD` (optional; set if Redis has `requirepass`)

---

## 2. Local Usage with Docker Compose (Optional, for quick test)

From the root project directory:

```bash
cd app

# Build and run app + local redis together
docker compose -f docker-compose.local.yml up --build
```

Open in browser: `http://localhost:3000`

Try:

- `curl http://localhost:3000/health`
- `curl http://localhost:3000/redis-health`

Stop:

```bash
docker compose -f docker-compose.local.yml down -v
```

---

## 3. GCP Scenario: 3 VMs

You will create:

- **VM1: app-vm** → runs the Node.js app container  
- **VM2: redis-vm** → runs the initial Redis container (primary)  
- **VM3: redis-migration-vm** → where you practice migrating Redis to a new VM

### 3.1. Common setup: Install Docker on all three VMs

On **each** VM (VM1, VM2, VM3):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] \
 https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
 | sudo tee /etc/apt/sources.list.d/docker.list

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

sudo usermod -aG docker $USER
# then log out and log back in or run:
newgrp docker
```

---

## 4. VM2: Run the primary Redis instance

On **VM2 (redis-vm)**, run Redis in Docker:

```bash
# choose a password
export REDIS_PASSWORD="mypassword123"

docker run -d \
  --name redis-primary \
  -p 6379:6379 \
  -v redis-primary-data:/data \
  redis:7.2 \
  redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --maxmemory 256mb \
    --maxmemory-policy allkeys-lru
```

Check Redis:

```bash
sudo apt-get install -y redis-tools  # if not already
redis-cli -h 127.0.0.1 -p 6379 -a "$REDIS_PASSWORD" ping
```

Note the **internal IP** of VM2 (for use by the app on VM1).

```bash
hostname -I
# e.g. 10.128.0.5
```

---

## 5. VM1: Run the app and connect to Redis on VM2

On **VM1 (app-vm)**:

### 5.1. Copy app code (from your machine)

From your local machine (where you downloaded this project):

```bash
# Zip already provided, but for real life, you'd upload:
gcloud compute scp redis-migration-demo.zip app-vm:~/
```

Unzip on VM1:

```bash
unzip redis-migration-demo.zip
cd redis-migration-demo/app
```

### 5.2. Build the app Docker image

```bash
docker build -t redis-migration-demo-app:v1 .
```

### 5.3. Set env pointing to Redis (VM2 internal IP)

```bash
echo 'export REDIS_HOST="10.128.0.6"' >> ~/.bashrc
echo 'export REDIS_PORT="6379"' >> ~/.bashrc
echo 'export REDIS_PASSWORD="redis"' >> ~/.bashrc
```
```bash
source ~/.bashrc
```

### 5.4. Run the app container

```bash
docker run -d \
  --name redis-demo-app \
  -p 3000:3000 \
  -e REDIS_HOST="$REDIS_HOST" \
  -e REDIS_PORT="$REDIS_PORT" \
  -e REDIS_PASSWORD="$REDIS_PASSWORD" \
  redis-migration-demo-app:v1
```

### 5.5. Test the app from browser or curl

From your local machine (if VM1 has external IP):

```bash
curl http://<APP_VM_EXTERNAL_IP>:3000/health
curl http://<APP_VM_EXTERNAL_IP>:3000/redis-health
```

Test storing a key:

```bash
curl -X POST http://<APP_VM_EXTERNAL_IP>:3000/set \
  -H "Content-Type: application/json" \
  -d '{"key":"color","value":"blue"}'

curl "http://<APP_VM_EXTERNAL_IP>:3000/get?key=color"
```

---

## 6. VM3: Practice Redis migration (like production)

Now you simulate migrating Redis from **VM2** to **VM3** with minimal downtime.

### 6.1. On VM2: Create a fresh backup of Redis data

```bash
# trigger save to disk
docker exec -it redis-primary redis-cli -a "$REDIS_PASSWORD" SAVE

# copy RDB file from container
mkdir -p ~/redis-backups
docker cp redis-primary:/data/dump.rdb ~/redis-backups/dump-$(date +%F-%H%M).rdb
```

### 6.2. On VM3: Prepare volume and container

To copy backup to migrate-vm

Create ssh key on new migration-redis server

```bash
ssh-keygen
```

copy 
```bash
cat ~/.ssh/id_ed25519
```

Paste to old redis-server
```bash
vim ~/.ssh/id_ed25519
Change permission to redis-server
chmod 600 ~/id_ed25519
chmod 700 ~/.ssh
```

Change permission to new migration-redis
```bash
cat id_ed25519.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
chmod 700 /root/.ssh
```

Copy dump.rdb file
```bash
scp -i ~/id_ed25519 ~/redis-backups/dump.rdb root@<redis-migration-vm>:/tmp
```
Freez image(so redis:latest does not change)
```bash
docker commit redis-securer redis-prod-backup:v1
docker save -o /root/redis-backups/redis-prod-backup-v1.tar redis-prod-backup:v1

scp -i ~/.ssh/id_ed25519 redis-backups/redis-prod-backup-v1.tar  root@104.197.12.174:/tmp/
```

Load image on new vm
```bash
docker  load -i /tmp/redis-prod-backup-v1.tar
```


On **VM3 (redis-migration-vm)**:

```bash
docker volume create redis-data-migrated

# find the mountpoint
docker volume inspect redis-data-migrated | grep Mountpoint
# e.g. /var/lib/docker/volumes/redis-data-migrated/_data

sudo cp ~/dump-*.rdb /var/lib/docker/volumes/redis-data-migrated/_data/dump.rdb
sudo chown -R root:root /var/lib/docker/volumes/redis-data-migrated/_data/
```

Run Redis on VM3 with the **same password**:

```bash
export REDIS_PASSWORD="mypassword123"

docker run -d \
  --name redis-migrated \
  -p 6379:6379 \
  -v redis-data-migrated:/data \
  redis:7.2 \
  redis-server \
    --requirepass "$REDIS_PASSWORD" \
    --maxmemory 256mb \
    --maxmemory-policy allkeys-lru
```

Test:

```bash
redis-cli -h 127.0.0.1 -p 6379 -a "$REDIS_PASSWORD" ping
redis-cli -h 127.0.0.1 -p 6379 -a "$REDIS_PASSWORD" dbsize
```

---

## 7. Switching the App from VM2 → VM3 (Migration Practice)

In a real setup you might:

- Use **the same IP** for both Redis VMs via static IP reassignment  
**or**
- Use a DNS name like `redis.internal` and update the DNS record

For practice, you can:

1. On **VM1 (app-vm)**, stop the app container:

    ```bash
    docker stop redis-demo-app
    ```

2. Point env vars to **VM3 internal IP**:

    ```bash
    echo 'export REDIS_HOST="<REDIS_PUBLIC-IP>"' >> ~/.bashrc
    echo 'export REDIS_PORT="6379"' >> ~/.bashrc
    echo 'export REDIS_PASSWORD="<redis-pass>"' >> ~/.bashrc

    source ~/.bashrc
    ```

3. Start app container again:

    ```bash
    docker run -d \
      --name redis-demo-app \
      -p 3000:3000 \
      -e REDIS_HOST="$REDIS_HOST" \
      -e REDIS_PORT="$REDIS_PORT" \
      -e REDIS_PASSWORD="$REDIS_PASSWORD" \
      redis-migration-demo-app:v1
    ```

4. Verify the data still exists:

    ```bash
    curl "http://<APP_VM_EXTERNAL_IP>:3000/get?key=color"
    # Expect to see: "blue"
    ```

This mimics your real-world VM → VM Redis migration.

---

## 8. Cleaning up

On each VM, to stop and remove containers/volumes:

```bash
docker ps
docker stop redis-demo-app redis-primary redis-migrated 2>/dev/null || true
docker rm redis-demo-app redis-primary redis-migrated 2>/dev/null || true
docker volume rm redis-primary-data redis-data-migrated 2>/dev/null || true
```

---

## 9. Files in this project

- `app/server.js` — Node.js Express app using Redis
- `app/package.json` — Node app metadata
- `app/Dockerfile` — Container for the app
- `app/docker-compose.local.yml` — Optional local test for app + redis
- `app/.env.example` — Example env vars for local development

You can modify the app to add more routes or more complex Redis usage (sessions, caching, rate limits, etc.).
