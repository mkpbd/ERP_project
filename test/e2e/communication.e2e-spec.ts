import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmsSender } from '../../src/modules/portal/application/portal.ports.js';
import type { LogSmsSender } from '../../src/modules/portal/infrastructure/security/portal-security.js';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>, token = admin): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, roleId: string): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  await request(http).post(`/api/v1/users/${created.body.id}/roles`).set(bearer(admin)).send({ roleId }).expect(204);
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

const comm = (method: 'get' | 'post', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/communication/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const portal = (method: 'get' | 'post', path: string, token?: string, body?: object) => {
  const call = request(http)[method](`/api/v1/portal/${path}`);
  if (token) call.set(bearer(token));
  return body ? call.send(body) : call;
};

/** A registered patient signed in to the portal with the code sent to their mobile. */
async function signedInPatient(fullName: string, mobileNo: string): Promise<string> {
  const id = await create('hospital/patients', { fullName, sex: 'male', dateOfBirth: '1980-01-01', mobileNo });
  const uhid = (await request(http).get(`/api/v1/hospital/patients/${id}`).set(bearer(admin)).expect(200)).body
    .uhid as number;
  const sent = await portal('post', 'otp', undefined, { uhid, contact: mobileNo }).expect(202);
  const texts = t.app.get<SmsSender, LogSmsSender>(SmsSender).sent;
  const code = /\b(\d{6})\b/.exec(texts[texts.length - 1]!.text)![1];
  return (await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code }).expect(200)).body
    .accessToken as string;
}

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
});

describe('communication', () => {
  it('publishes health tips to the portal and sends notices that each recipient reads', async () => {
    const editor = await user('editor', await create('roles', { name: 'Editors', permissions: ['content:manage'] }));
    const nurses = await create('roles', { name: 'Nurses', permissions: [] });
    const [mitu, shirin] = [await user('mitu', nurses), await user('shirin', nurses)];
    const sender = await user('sender', await create('roles', { name: 'Senders', permissions: ['notice:send'] }));

    // Tips: pinned first; a future one and an inactive one stay hidden; images over https only.
    await create(
      'communication/health-tips',
      { title: 'Wash your hands', body: 'Twenty seconds with soap.', category: 'hygiene' },
      editor.token,
    );
    await create(
      'communication/health-tips',
      {
        title: 'Dengue season',
        titleBn: 'ডেঙ্গু মৌসুম',
        body: 'Empty standing water.',
        isPinned: true,
        category: 'season',
      },
      editor.token,
    );
    await create(
      'communication/health-tips',
      { title: 'Coming soon', body: 'x', publishFrom: later(24) },
      editor.token,
    );
    await create('communication/health-tips', { title: 'Old', body: 'x', isActive: false }, editor.token);
    const insecure = await comm('post', 'health-tips', editor.token, {
      title: 'Pic',
      body: 'x',
      imageUrl: 'http://example.com/a.png',
    });
    expect(insecure.status).toBe(400);
    expect((await comm('post', 'health-tips', sender.token, { title: 'No', body: 'x' })).status).toBe(403);
    const tips = await portal('get', 'health-tips').expect(200);
    expect(tips.body.items.map((tip: { title: string }) => tip.title)).toEqual(['Dengue season', 'Wash your hands']);
    expect((await portal('get', 'health-tips?category=hygiene').expect(200)).body.items).toHaveLength(1);

    // A notice to the nurses (Mitu also named): each once.
    expect((await comm('post', 'notices', mitu.token, { title: 'x', body: 'y', userIds: [shirin.id] })).status).toBe(
      403,
    );
    const empty = await create('roles', { name: 'Nobody', permissions: [] });
    expect((await comm('post', 'notices', sender.token, { title: 'x', body: 'y', roleIds: [empty] })).body.code).toBe(
      'no_recipients',
    );
    const sent = await comm('post', 'notices', sender.token, {
      title: 'Fire drill',
      body: 'Fire drill at 3 pm today. Gather at the car park.',
      userIds: [mitu.id],
      roleIds: [nurses],
    }).expect(201);
    expect(sent.body.recipients).toBe(2);
    const mine = await comm('get', 'notices/mine', mitu.token).expect(200);
    expect(mine.body).toMatchObject({
      unread: 1,
      items: [expect.objectContaining({ title: 'Fire drill', readAt: null })],
    });
    await comm('post', `notices/${sent.body.id}/read`, mitu.token).expect(204);
    expect((await comm('get', 'notices/mine?unread=true', mitu.token).expect(200)).body).toEqual({
      items: [],
      unread: 0,
    });
    expect((await comm('post', `notices/${sent.body.id}/read`, editor.token)).status).toBe(404);
    const outbox = await comm('get', 'notices/sent', sender.token).expect(200);
    expect(outbox.body.items[0]).toMatchObject({ title: 'Fire drill', recipients: 2, read: 1 });
  });

  it('lets a patient chat with staff, who take, answer and close the chat', async () => {
    const agents = await create('roles', { name: 'Agents', permissions: ['chat:answer'] });
    const [rana, joba] = [await user('rana', agents), await user('joba', agents)];
    const karim = await signedInPatient('Karim Uddin', '01711000000');
    const selim = await signedInPatient('Selim Reza', '01611000000');

    const chat = await portal('post', 'chats', karim, {
      topic: 'Report time',
      text: 'When is my CBC report ready?',
    }).expect(201);
    expect((await portal('get', 'chats', karim).expect(200)).body.items[0]).toMatchObject({
      status: 'open',
      unread: 0,
    });

    // The agents see it unread; Rana answers it and so has it; Joba takes it over to answer.
    const open = await comm('get', 'chats?status=open', rana.token).expect(200);
    expect(open.body.items[0]).toMatchObject({ patientName: 'Karim Uddin', unread: 1, assignedTo: null });
    await comm('post', `chats/${chat.body.id}/messages`, rana.token, { text: 'Let me check, please wait.' }).expect(
      201,
    );
    const busy = await comm('post', `chats/${chat.body.id}/messages`, joba.token, { text: 'Hello' });
    expect(busy.body.code).toBe('not_your_chat');
    await comm('post', `chats/${chat.body.id}/take`, joba.token).expect(204);
    await comm('post', `chats/${chat.body.id}/messages`, joba.token, { text: 'It is ready after 5 pm.' }).expect(201);
    expect((await comm('get', 'chats?mine=true', joba.token).expect(200)).body.items).toHaveLength(1);

    // Karim reads both answers; another patient cannot see his chat.
    expect((await portal('get', 'chats', karim).expect(200)).body.items[0].unread).toBe(2);
    const messages = await portal('get', `chats/${chat.body.id}/messages`, karim).expect(200);
    expect(
      messages.body.items.map((entry: { sender: string; senderName: string }) => [entry.sender, entry.senderName]),
    ).toEqual([
      ['patient', 'Karim Uddin'],
      ['staff', 'rana'],
      ['staff', 'joba'],
    ]);
    expect((await portal('get', 'chats', karim).expect(200)).body.items[0].unread).toBe(0);
    expect((await portal('get', `chats/${chat.body.id}/messages`, selim)).status).toBe(404);
    expect((await portal('post', `chats/${chat.body.id}/messages`, selim, { text: 'hi' })).status).toBe(404);
    expect((await portal('get', 'chats', admin)).status).toBe(401);

    // At most three open chats; a closed chat takes no more messages.
    await portal('post', 'chats', karim, { topic: 'Bill', text: 'Can I pay by card?' }).expect(201);
    await portal('post', 'chats', karim, { topic: 'Doctor', text: 'Is Dr. Nusrat in today?' }).expect(201);
    expect((await portal('post', 'chats', karim, { topic: 'More', text: 'x' })).body.code).toBe('too_many_chats');
    expect((await comm('post', `chats/${chat.body.id}/close`, rana.token)).body.code).toBe('not_your_chat');
    await comm('post', `chats/${chat.body.id}/close`, joba.token).expect(204);
    expect((await portal('post', `chats/${chat.body.id}/messages`, karim, { text: 'Thanks' })).body.code).toBe(
      'chat_closed',
    );
    await portal('post', 'chats', karim, { topic: 'More', text: 'One more question' }).expect(201);
  });
});
