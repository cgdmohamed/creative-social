import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Co godzine dociaga komentarze i rozmowy ze wszystkich kanalow do lokalnej
 * bazy. Dzieki temu panel otwiera sie natychmiast, bo czyta gotowe dane,
 * zamiast czekac na odpowiedzi platform przy kazdym wejsciu.
 */
@Injectable()
export class SyncInbox {
  constructor(
    private _integrationService: IntegrationService,
    private _organizations: PrismaRepository<'organization'>
  ) {}

  @Cron('7 * * * *')
  async handleCron() {
    const organizations = await this._organizations.model.organization.findMany({
      select: { id: true },
    });

    // Organizacje po kolei, kanaly wewnatrz organizacji rownolegle - inaczej
    // przy wielu kontach poszlaby lawina wywolan do Meta naraz.
    for (const org of organizations) {
      await this._integrationService.syncOrganization(org.id, 'comment');
      await this._integrationService.syncOrganization(org.id, 'conversation');
    }
  }
}
