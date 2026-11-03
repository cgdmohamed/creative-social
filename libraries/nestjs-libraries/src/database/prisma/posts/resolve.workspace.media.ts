// Resolve stored media IDs in the post's workspace, including normalization
// updates. Unowned/deleted IDs are dropped, never replaced by client metadata.
export async function resolveWorkspaceMedia(
  images: any[], organizationId: string,
  load: (id: string, orgId: string) => Promise<any>,
  changed: () => void
) {
  if (!organizationId) throw new Error('Workspace required');
  return Promise.all(images.map(async (image) => {
    // External/public asset URLs have no library ID and remain supported.
    if (!image.id) return image;
    const media = await load(image.id, organizationId);
    if (!media) { changed(); return null; }
    if (!image.path) { changed(); return media; }
    if (media.status === 'ready' && media.path !== image.path) {
      changed();
      return { ...image, name: media.name, path: media.path };
    }
    return image;
  }));
}
