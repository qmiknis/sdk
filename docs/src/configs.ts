export type VersionType = string;

export interface VersionConfig {
  id: VersionType;
  label: string;
  pathPrefix: string;
  description?: string;
  packages: string[];
  isDefault?: boolean;
  isPreview?: boolean;
}

// Function to extract packages from SDK file content
function parsePackagesFromSdkContent(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      // Extract package name before any brackets or version specifiers
      const match = line.match(/^([a-zA-Z0-9-_]+)/);
      return match ? match[1] : line;
    })
    .filter(pkg => pkg);
}

// Function to parse the advertised_sdk.txt manifest.
// Each non-empty, non-comment line lists an SDK file to advertise, e.g.:
//   sdk4_4.txt
//   sdk4_5.txt,default
// The optional ",default" marker flags the default version.
function parseAdvertisedSdk(content: string): {filename: string, isDefault: boolean}[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split(',').map(part => part.trim());
      const filename = parts[0];
      const isDefault = parts.slice(1).some(part => part.toLowerCase() === 'default');
      return { filename, isDefault };
    })
    .filter(entry => entry.filename);
}

// Function to discover SDK files from the advertised_sdk.txt manifest
async function discoverSdkFiles(): Promise<{filename: string, path: string, isDefault: boolean}[]> {
  const manifestPath = './advertised_sdk.txt';

  try {
    const response = await fetch(manifestPath);

    if (response.ok && response.status === 200 && response.headers.get('content-type')?.includes('text')) {
      const text = await response.text();

      // Guard against SPA fallbacks returning index.html for missing files
      if (text.includes('<html>') || text.includes('<HTML>') || text.includes('<!DOCTYPE')) {
        console.warn('✗ Invalid advertised_sdk.txt: looks like HTML');
        return [];
      }

      const entries = parseAdvertisedSdk(text);
      if (entries.length === 0) {
        console.warn('✗ No SDK files listed in advertised_sdk.txt');
        return [];
      }

      const sdkFiles = entries.map(({ filename, isDefault }) => ({
        filename,
        path: `./${filename}`,
        isDefault
      }));

      console.log('✓ Loaded advertised_sdk.txt:', sdkFiles.map(f => f.filename));
      console.log(`📁 Total SDK files advertised: ${sdkFiles.length}`);
      return sdkFiles;
    }

    console.warn(`✗ Failed to fetch advertised_sdk.txt: status ${response.status}`);
  } catch {
    console.warn('✗ advertised_sdk.txt not found');
  }

  return [];
}

// Function to generate version configurations from SDK files
async function generateVersionConfigs(): Promise<VersionConfig[]> {
  const configs: VersionConfig[] = [];

  // Dynamically discover SDK files
  const sdkFiles = await discoverSdkFiles();

  if (sdkFiles.length === 0) {
    console.warn('No SDK files found, falling back to static configuration');
    return [];
  }

  let defaultVersion: string | null = null;

  for (const { filename, path, isDefault } of sdkFiles) {
    try {
      const response = await fetch(path);
      if (!response.ok) continue;

      const content = await response.text();

      const packages = parsePackagesFromSdkContent(content);

      // Extract version info from filename
      const versionMatch = filename.match(/sdk(\d+)_(\d+)\.txt/);
      if (!versionMatch) continue;

      const [, major, minor] = versionMatch;
      const versionKey = `${major}_${minor}`;

      if (isDefault) {
        defaultVersion = versionKey;
      }

      const config: VersionConfig = {
        id: versionKey,
        label: `IQM OS ${major}.${minor}${isDefault ? ' (Resonance)' : ''}`,
        // Every advertised version (including the default) is built into its
        // own ./sdkX_Y/ directory by build.sh.
        pathPrefix: `./sdk${major}_${minor}/`,
        packages,
        isDefault,
        isPreview: false
      };

      configs.push(config);
    } catch (error) {
      console.warn(`Failed to load ${filename}:`, error);
    }
  }

  // Sort by version (newest first)
  configs.sort((a, b) => {
    const [aMajor, aMinor] = a.id.split('_').map(Number);
    const [bMajor, bMinor] = b.id.split('_').map(Number);

    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });

  // Mark versions newer than default as preview
  if (defaultVersion) {
    const [defaultMajor, defaultMinor] = defaultVersion.split('_').map(Number);
    configs.forEach(config => {
      if (!config.isDefault) {
        const [major, minor] = config.id.split('_').map(Number);
        const isNewer = major > defaultMajor || (major === defaultMajor && minor > defaultMinor);

        if (isNewer) {
          config.isPreview = true;
          config.description = `⚠️ You are viewing preview documentation for IQM OS ${major}.${minor}. This version may contain experimental features and is subject to change.`;
        } else {
          config.description = `You are viewing documentation for IQM OS ${major}.${minor}. This version applies for on-premises installations.`;
        }
      }
    });
  }

  return configs;
}

// Export a promise that resolves to the version configs
export const versionConfigsPromise = generateVersionConfigs();

// Initial value before the dynamic configs (from advertised_sdk.txt) resolve.
// Kept empty on purpose: a hardcoded version here would be shown to users while
// loading and would linger as a stale/misleading version if discovery fails.
export const versionConfigs: VersionConfig[] = [];
