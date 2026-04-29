import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DRIZZLE } from '../database/database.module';
import { SessionService } from '../session/session.service';
import * as schema from '../database/schema';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly sessionService: SessionService,
  ) {}

  async login(username: string): Promise<{ sessionToken: string; user: schema.User }> {
    let user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!user) {
      const id = `usr_${uuidv4().replace(/-/g, '').slice(0, 6)}`;
      const inserted = await this.db
        .insert(schema.users)
        .values({ id, username })
        .returning();
      user = inserted[0];
    }

    const token = `sess_${randomBytes(32).toString('hex')}`;
    await this.sessionService.setSession(token, user.id, user.username);

    return { sessionToken: token, user };
  }
}
