import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { EmailSender, type RenderedEmail } from '../application/email.js';

export class SmtpEmailSender extends EmailSender {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(email: RenderedEmail): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: email.to, subject: email.subject, text: email.text });
  }
}

/**
 * Development transport: writes each message to its own file instead of
 * logging it, so links containing tokens never reach the log stream.
 */
export class FileEmailSender extends EmailSender {
  constructor(
    private readonly directory: string,
    private readonly from: string,
  ) {
    super();
  }

  async send(email: RenderedEmail): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const body = `From: ${this.from}\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`;
    await writeFile(path.join(this.directory, name), body, { encoding: 'utf8', mode: 0o600 });
  }
}

/** Test transport: keeps messages in memory for assertions. */
@Injectable()
export class InMemoryEmailSender extends EmailSender {
  readonly sent: RenderedEmail[] = [];

  send(email: RenderedEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}
