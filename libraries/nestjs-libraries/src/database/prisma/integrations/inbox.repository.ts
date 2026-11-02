import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Lokalna kopia komentarzy i rozmow z platform.
 *
 * Panel czyta wylacznie stad, dzieki czemu otwiera sie natychmiast zamiast
 * czekac na Graph API. Swiezosc zapewnia cron, ktory synchronizuje kanaly
 * w tle.
 */
@Injectable()
export class InboxRepository {
  constructor(
    private _items: PrismaRepository<'inboxItem'>,
    private _sync: PrismaRepository<'inboxSync'>
  ) {}

  list(org: string, kind: string, integrationIds?: string[]) {
    return this._items.model.inboxItem.findMany({
      where: {
        // Wlasne komentarze TEZ pobieramy: nie trafiaja na liste, ale sa
        // potrzebne, zeby pokazac nasza odpowiedz w watku pod komentarzem.
        organizationId: org,
        kind,
        integration: { disabled: false, deletedAt: null },
        ...(integrationIds?.length
          ? { integrationId: { in: integrationIds } }
          : {}),
      },
      orderBy: { happenedAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Comments under one publication, ours included.
   *
   * Keyed by the platform's own post id (Post.releaseId), because that is the
   * only identifier both sides share: the inbox knows nothing about our
   * calendar rows.
   */
  commentsForPost(org: string, integrationId: string, postId: string) {
    return this._items.model.inboxItem.findMany({
      where: {
        organizationId: org,
        integrationId,
        kind: 'comment',
        postId,
      },
      orderBy: { happenedAt: 'asc' },
      take: 500,
    });
  }

  /**
   * Stores fetched items. The (integrationId, externalId, kind) key makes a
   * re-sync update the existing row instead of creating a duplicate, so an
   * `isRead` flag survives later runs.
   */
  async upsertMany(
    org: string,
    integrationId: string,
    kind: string,
    items: Array<{
      externalId: string;
      authorName?: string;
      authorId?: string;
      content: string;
      permalink?: string;
      parentId?: string;
      postId?: string;
      postText?: string;
      postUrl?: string;
      payload?: any;
      happenedAt: Date;
      isOwn?: boolean;
    }>
  ) {
    for (const item of items) {
      const existing = await this.findItem(
        org,
        integrationId,
        item.externalId,
        kind
      );
      const data = {
        authorName: item.authorName,
        authorId: item.authorId,
        content: item.content,
        permalink: item.permalink,
        parentId: item.parentId,
        postId: item.postId,
        postText: item.postText,
        postUrl: item.postUrl,
        payload: item.payload ?? undefined,
        happenedAt: item.happenedAt,
        isOwn: !!item.isOwn,
        ...(existing && item.happenedAt > existing.happenedAt
          ? { isRead: false }
          : {}),
      };

      await this._items.model.inboxItem.upsert({
        where: {
          integrationId_externalId_kind: {
            integrationId,
            externalId: item.externalId,
            kind,
          },
        },
        create: {
          organizationId: org,
          integrationId,
          externalId: item.externalId,
          kind,
          ...data,
        },
        update: data,
      });
    }
  }

  findItem(
    org: string,
    integrationId: string,
    externalId: string,
    kind: string
  ) {
    return this._items.model.inboxItem.findFirst({
      where: { organizationId: org, integrationId, externalId, kind },
    });
  }

  markRead(org: string, ids: string[], read: boolean) {
    return this._items.model.inboxItem.updateMany({
      where: { organizationId: org, externalId: { in: ids } },
      data: { isRead: read },
    });
  }

  syncState(org: string) {
    return this._sync.model.inboxSync.findMany({
      where: { organizationId: org },
    });
  }

  saveSync(org: string, integrationId: string, kind: string, error?: string) {
    const data = {
      ...(error ? {} : { lastSyncAt: new Date() }),
      lastError: error || null,
    };
    return this._sync.model.inboxSync.upsert({
      where: { integrationId_kind: { integrationId, kind } },
      create: { organizationId: org, integrationId, kind, ...data },
      update: data,
    });
  }
}
