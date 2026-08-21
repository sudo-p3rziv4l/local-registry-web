const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');

const fs = require('fs');

// Load .env file automatically at server startup
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (key && process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    });
  }
}

// Helper to make HTTP request with node standard http module (handles windows network/proxy/node fetch edge cases)
const httpGetJson = (urlStr) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        rejectUnauthorized: false,
        timeout: parseInt(process.env.HTTP_TIMEOUT, 10) || 10000
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

const httpGetRaw = (urlStr, headers = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...headers
        },
        rejectUnauthorized: false,
        timeout: parseInt(process.env.HTTP_TIMEOUT, 10) || 10000
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

const getTagDetail = async (registryUrl, name, tag) => {
  try {
    const acceptHeader = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, */*'
    };
    let manifestRes = await httpGetRaw(`${registryUrl}/v2/${name}/manifests/${tag}`, acceptHeader);
    if (manifestRes.status !== 200) return { tag, created: null, size: null };

    let manifest = JSON.parse(manifestRes.data);

    // If OCI index or manifest list, find specific platform or first manifest
    if (manifest.manifests && manifest.manifests.length > 0) {
      const targetManifest = manifest.manifests.find(m => m.platform && m.platform.architecture === (process.env.TARGET_ARCH || 'amd64')) || manifest.manifests[0];
      if (targetManifest && targetManifest.digest) {
        manifestRes = await httpGetRaw(`${registryUrl}/v2/${name}/manifests/${targetManifest.digest}`, acceptHeader);
        if (manifestRes.status === 200) manifest = JSON.parse(manifestRes.data);
      }
    }

    let created = null;
    let totalSize = 0;

    if (manifest.layers && Array.isArray(manifest.layers)) {
      totalSize = manifest.layers.reduce((acc, layer) => acc + (layer.size || 0), 0);
    }

    if (manifest.config && manifest.config.digest) {
      if (manifest.config.size) totalSize += manifest.config.size;
      const blobRes = await httpGetRaw(`${registryUrl}/v2/${name}/blobs/${manifest.config.digest}`);
      if (blobRes.status === 200) {
        try {
          const configObj = JSON.parse(blobRes.data);
          created = configObj.created || null;
        } catch (e) {}
      }
    } else if (manifest.history && manifest.history[0] && manifest.history[0].v1Compatibility) {
      try {
        const v1Comp = JSON.parse(manifest.history[0].v1Compatibility);
        created = v1Comp.created || null;
      } catch (e) {}
    }

    return { tag, created, size: totalSize };
  } catch (err) {
    return { tag, created: null, size: null };
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to execute CLI commands returning stdout as string
const runCommand = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: parseInt(process.env.EXEC_MAX_BUFFER, 10) || 10485760 }, (error, stdout, stderr) => {
      if (error) {
        return resolve({ error: error.message || stderr });
      }
      resolve({ stdout: stdout.trim() });
    });
  });
};

// API: Get Server Configuration
app.get('/api/config', (req, res) => {
  res.json({
    status: 'success',
    defaultRegistryUrl: process.env.DEFAULT_REGISTRY_URL || 'http://10.0.3.51:5000'
  });
});

// API: Get List of Docker Images
app.get('/api/images', async (req, res) => {
  // Format docker images output as json using custom format template
  const format = '{"id":"{{.ID}}","repository":"{{.Repository}}","tag":"{{.Tag}}","created":"{{.CreatedAt}}","size":"{{.Size}}","digest":"{{.Digest}}"}';
  const command = `docker images --format "${format}"`;
  
  const result = await runCommand(command);
  
  if (result.error) {
    return res.status(500).json({ status: 'error', message: result.error });
  }

  try {
    const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
    const images = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(img => img !== null);

    res.json({ status: 'success', data: images });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// API: Remove Image
app.delete('/api/images/:id', async (req, res) => {
  const imageId = req.params.id;
  const force = req.query.force === 'true' ? '-f' : '';
  const command = `docker rmi ${force} ${imageId}`;
  
  const result = await runCommand(command);
  if (result.error) {
    return res.status(400).json({ status: 'error', message: result.error });
  }
  res.json({ status: 'success', output: result.stdout });
});

// API: Docker System Info / Disk Usage
app.get('/api/system/info', async (req, res) => {
  const command = `docker system df --format "{{json .}}"`;
  const result = await runCommand(command);
  
  if (result.error) {
    return res.status(500).json({ status: 'error', message: result.error });
  }

  try {
    const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
    const usage = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(item => item !== null);

    res.json({ status: 'success', data: usage });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// API: Query a Docker Registry V2 if user inputs custom registry URL (e.g. 10.0.3.51:5000)
app.get('/api/registry/catalog', async (req, res) => {
  let registryUrl = (req.query.url || process.env.DEFAULT_REGISTRY_URL || 'http://10.0.3.51:5000').trim();
  if (!/^https?:\/\//i.test(registryUrl)) {
    registryUrl = 'http://' + registryUrl;
  }
  registryUrl = registryUrl.replace(/\/+$/, '');
  try {
    const data = await httpGetJson(`${registryUrl}/v2/_catalog`);
    res.json({ status: 'success', repositories: data.repositories || [] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// API: Calculate total size of all images in Docker Registry V2
app.get('/api/registry/size', async (req, res) => {
  let registryUrl = (req.query.url || process.env.DEFAULT_REGISTRY_URL || 'http://10.0.3.51:5000').trim();
  if (!/^https?:\/\//i.test(registryUrl)) {
    registryUrl = 'http://' + registryUrl;
  }
  registryUrl = registryUrl.replace(/\/+$/, '');

  try {
    const data = await httpGetJson(`${registryUrl}/v2/_catalog`);
    const repos = data.repositories || [];
    const acceptHeader = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, */*'
    };

    const blobDigests = new Set();
    let totalBytes = 0;
    let totalTagsCount = 0;

    await Promise.all(repos.map(async (repo) => {
      try {
        const tagsData = await httpGetJson(`${registryUrl}/v2/${repo}/tags/list`);
        const tags = tagsData.tags || [];
        totalTagsCount += tags.length;

        await Promise.all(tags.map(async (tag) => {
          try {
            let manifestRes = await httpGetRaw(`${registryUrl}/v2/${repo}/manifests/${tag}`, acceptHeader);
            if (manifestRes.status !== 200) return;
            let manifest = JSON.parse(manifestRes.data);

            if (manifest.manifests && manifest.manifests.length > 0) {
              const target = manifest.manifests.find(m => m.platform && m.platform.architecture === (process.env.TARGET_ARCH || 'amd64')) || manifest.manifests[0];
              if (target && target.digest) {
                manifestRes = await httpGetRaw(`${registryUrl}/v2/${repo}/manifests/${target.digest}`, acceptHeader);
                if (manifestRes.status === 200) manifest = JSON.parse(manifestRes.data);
              }
            }

            if (manifest.layers && Array.isArray(manifest.layers)) {
              for (const layer of manifest.layers) {
                if (layer.digest) {
                  if (!blobDigests.has(layer.digest)) {
                    blobDigests.add(layer.digest);
                    totalBytes += (layer.size || 0);
                  }
                } else {
                  totalBytes += (layer.size || 0);
                }
              }
            }

            if (manifest.config && manifest.config.size) {
              if (manifest.config.digest) {
                if (!blobDigests.has(manifest.config.digest)) {
                  blobDigests.add(manifest.config.digest);
                  totalBytes += manifest.config.size;
                }
              } else {
                totalBytes += manifest.config.size;
              }
            }
          } catch (e) {}
        }));
      } catch (e) {}
    }));

    res.json({ status: 'success', totalBytes, repositoriesCount: repos.length, totalTagsCount });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// API: Get tags for a specific repository in Docker Registry V2
app.get('/api/registry/tags', async (req, res) => {
  let registryUrl = (req.query.url || process.env.DEFAULT_REGISTRY_URL || 'http://10.0.3.51:5000').trim();
  if (!/^https?:\/\//i.test(registryUrl)) {
    registryUrl = 'http://' + registryUrl;
  }
  registryUrl = registryUrl.replace(/\/+$/, '');
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ status: 'error', message: 'Repository name parameter required' });
  }

  try {
    const data = await httpGetJson(`${registryUrl}/v2/${name}/tags/list`);
    const tagList = data.tags || [];

    const tagDetails = await Promise.all(
      tagList.map(tag => getTagDetail(registryUrl, name, tag))
    );

    res.json({ status: 'success', name: data.name, tags: tagList, tagDetails });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server Docker Monitoring running on http://localhost:${PORT}`);
});