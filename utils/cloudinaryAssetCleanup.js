import cloudinary from 'cloudinary';
import { logError } from './auditLogger.js';

const normalizeResourceTypes = (resourceTypes = []) =>
  [...new Set(resourceTypes.filter(Boolean))];

export const deduplicateCloudinaryAssets = (assets = []) => {
  const assetsByPublicId = new Map();

  for (const asset of assets) {
    if (!asset?.publicId) continue;

    const existing = assetsByPublicId.get(asset.publicId) || {
      publicId: asset.publicId,
      resourceTypes: [],
    };
    existing.resourceTypes = normalizeResourceTypes([
      ...existing.resourceTypes,
      ...(asset.resourceTypes || []),
    ]);
    assetsByPublicId.set(asset.publicId, existing);
  }

  return [...assetsByPublicId.values()];
};

export const destroyCloudinaryAssets = async (
  assets,
  {
    cloudinaryClient = cloudinary,
    failureMessage = 'Failed to delete asset from Cloudinary',
    context = {},
    onError = logError,
  } = {},
) => {
  let deletedCount = 0;

  for (const asset of deduplicateCloudinaryAssets(assets)) {
    const failures = [];
    let deleted = false;

    for (const resourceType of asset.resourceTypes) {
      try {
        const result = await cloudinaryClient.uploader.destroy(asset.publicId, {
          resource_type: resourceType,
        });

        if (result?.result === 'ok') {
          deleted = true;
          break;
        }

        failures.push({
          resourceType,
          result: result?.result || 'unknown',
        });
      } catch (error) {
        failures.push({
          resourceType,
          error: error?.message || 'Unknown Cloudinary delete failure',
        });
      }
    }

    if (deleted) {
      deletedCount += 1;
      continue;
    }

    onError(
      failureMessage,
      new Error('Cloudinary deletion failed for all resource types'),
      {
        ...context,
        cloudinaryPublicId: asset.publicId,
        failures,
      },
    );
  }

  return deletedCount;
};
