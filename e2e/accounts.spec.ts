import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * Accounts van begin tot eind, in een echte browser tegen een echte database.
 *
 * Elke test bewijst één belofte uit src/lib/session.ts of
 * src/services/userService.ts die met een unittest niet te bewijzen is, omdat
 * ze over cookies, redirects en twee gelijktijdige sessies gaat.
 */

const DEMO_PASSWORD = 'immoradar'
const AGENCY_ADMIN = 'thomas@immo-example-gent.be'
const AGENT = 'sofie@immo-example-gent.be'
const PLATFORM_ADMIN = 'admin@immoradar.be'

const run = Date.now().toString(36)
const strongPassword = (label: string) => `e2e ${label} lange zin ${run} vensterbank`

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('E-mailadres').fill(email)
  await page.getByLabel('Wachtwoord', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Inloggen' }).click()
  // Wacht tot de server action klaar is: óf een doorverwijzing weg van /login,
  // óf een foutmelding op het formulier. Anders loopt de volgende `goto` een
  // race met de redirect van de login.
  await Promise.race([
    page.waitForURL((url) => url.pathname !== '/login'),
    page.locator('form p.text-danger').waitFor(),
  ])
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

/** Voegt via /team een collega toe en geeft het tijdelijke wachtwoord terug. */
async function addMember(page: Page, email: string, role: 'AGENT' | 'AGENCY_ADMIN'): Promise<string> {
  await page.goto('/team')
  await page.getByLabel('E-mailadres').fill(email)
  await page.getByLabel('Naam').fill(`E2E ${email.split('@')[0]}`)
  await page.getByLabel('Rol').selectOption(role)
  await page.getByRole('button', { name: 'Toevoegen' }).click()

  const issued = page.getByText(`Tijdelijk wachtwoord voor ${email}`)
  await expect(issued).toBeVisible()
  const code = issued.locator('xpath=..').locator('code')
  return (await code.textContent())?.trim() ?? ''
}

async function replaceTemporaryPassword(page: Page, temporary: string, next: string): Promise<void> {
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByText('Je bent ingelogd met een tijdelijk wachtwoord')).toBeVisible()
  await page.getByLabel('Huidig wachtwoord').fill(temporary)
  await page.getByLabel('Nieuw wachtwoord', { exact: true }).fill(next)
  await page.getByLabel('Nieuw wachtwoord, nog eens').fill(next)
  await page.getByRole('button', { name: 'Wachtwoord opslaan' }).click()
  // Na een geslaagde wijziging stuurt de server door; pas dan is het nieuwe
  // wachtwoord opgeslagen.
  await page.waitForURL((url) => url.pathname !== '/account')
}

test.describe.configure({ mode: 'serial' })

test('een kantoorbeheerder ziet het teambeheer, een makelaar niet', async ({ browser }) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)
  await expect(admin).toHaveURL(/\/$/)
  await expect(admin.getByRole('link', { name: 'Team' })).toBeVisible()

  const agent = await freshPage(browser)
  await login(agent, AGENT, DEMO_PASSWORD)
  await expect(agent).toHaveURL(/\/$/)
  await expect(agent.getByRole('link', { name: 'Team' })).toHaveCount(0)

  await agent.goto('/team')
  await expect(agent).toHaveURL(/\/$/)
})

test('nieuwe collega: tijdelijk wachtwoord, verplicht vervangen, daarna het dashboard', async ({
  browser,
}) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)

  const email = `nieuw-${run}@e2e.test`
  const temporary = await addMember(admin, email, 'AGENT')
  expect(temporary).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/)

  const member = await freshPage(browser)
  await login(member, email, temporary)
  await expect(member).toHaveURL(/\/account$/)

  // Met een tijdelijk wachtwoord kom je nergens anders.
  await member.goto('/pipeline')
  await expect(member).toHaveURL(/\/account$/)

  // Een zwak wachtwoord wordt geweigerd met een leesbare reden.
  await member.getByLabel('Huidig wachtwoord').fill(temporary)
  await member.getByLabel('Nieuw wachtwoord', { exact: true }).fill('kort')
  await member.getByLabel('Nieuw wachtwoord, nog eens').fill('kort')
  await member.getByLabel('Nieuw wachtwoord', { exact: true }).evaluate((input) =>
    input.removeAttribute('minlength'),
  )
  await member.getByLabel('Nieuw wachtwoord, nog eens').evaluate((input) =>
    input.removeAttribute('minlength'),
  )
  await member.getByRole('button', { name: 'Wachtwoord opslaan' }).click()
  await expect(member.getByText('Kies een wachtwoord van minstens 12 tekens.')).toBeVisible()

  await replaceTemporaryPassword(member, temporary, strongPassword('nieuw'))
  await expect(member).toHaveURL(/\/$/)
  await expect(member.getByRole('link', { name: 'Vandaag' })).toBeVisible()
})

test('deactiveren meldt de gebruiker meteen af, ook in een lopende sessie', async ({ browser }) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)

  const email = `vertrekt-${run}@e2e.test`
  const temporary = await addMember(admin, email, 'AGENT')

  const member = await freshPage(browser)
  await login(member, email, temporary)
  await replaceTemporaryPassword(member, temporary, strongPassword('vertrekt'))
  await expect(member).toHaveURL(/\/$/)

  await admin.goto('/team')
  const row = admin.getByRole('row').filter({ hasText: email })
  await row.getByRole('button', { name: 'Deactiveren' }).click()
  await expect(row.getByText('Gedeactiveerd')).toBeVisible()

  await member.goto('/pipeline')
  await expect(member).toHaveURL(/\/login$/)
})

test('de laatste beheerder kan zichzelf niet buitensluiten', async ({ browser }) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)
  await admin.goto('/team')

  const ownRow = admin.getByRole('row').filter({ hasText: AGENCY_ADMIN })
  await expect(ownRow.getByText('Dit ben jij')).toBeVisible()
  await expect(ownRow.getByRole('button', { name: 'Deactiveren' })).toHaveCount(0)
})

test('na vijf foute pogingen gaat het account op slot, ook voor het juiste wachtwoord', async ({
  browser,
}) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)

  const email = `slot-${run}@e2e.test`
  const temporary = await addMember(admin, email, 'AGENT')

  const attacker = await freshPage(browser)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await login(attacker, email, `fout-${attempt}`)
    await expect(attacker.getByText('Onjuiste combinatie van e-mailadres en wachtwoord.', { exact: false })).toBeVisible()
  }

  // Het juiste wachtwoord opent niets meer, en de melding is dezelfde als bij
  // een fout wachtwoord: een vergrendeling mag niet verraden dat het account bestaat.
  await login(attacker, email, temporary)
  await expect(attacker).toHaveURL(/\/login$/)
  await expect(attacker.getByText('Onjuiste combinatie van e-mailadres en wachtwoord.', { exact: false })).toBeVisible()

  // Een nieuw tijdelijk wachtwoord van de beheerder heft het slot op.
  await admin.goto('/team')
  const row = admin.getByRole('row').filter({ hasText: email })
  await expect(row.getByText('Vergrendeld')).toBeVisible()
  await row.getByRole('button', { name: 'Nieuw wachtwoord' }).click()
  const issued = row.getByText(`Tijdelijk wachtwoord voor ${email}`)
  await expect(issued).toBeVisible()
  const fresh = (await issued.locator('xpath=..').locator('code').textContent())?.trim() ?? ''

  await login(attacker, email, fresh)
  await expect(attacker).toHaveURL(/\/account$/)
})

test('overal afmelden beëindigt ook de sessie op een ander toestel', async ({ browser }) => {
  const admin = await freshPage(browser)
  await login(admin, AGENCY_ADMIN, DEMO_PASSWORD)

  const email = `overal-${run}@e2e.test`
  const temporary = await addMember(admin, email, 'AGENT')
  const password = strongPassword('overal')

  const laptop = await freshPage(browser)
  await login(laptop, email, temporary)
  await replaceTemporaryPassword(laptop, temporary, password)

  const phone = await freshPage(browser)
  await login(phone, email, password)
  await expect(phone).toHaveURL(/\/$/)

  await laptop.goto('/account')
  await laptop.getByRole('button', { name: 'Overal afmelden' }).click()
  await expect(laptop).toHaveURL(/\/login$/)

  await phone.goto('/pipeline')
  await expect(phone).toHaveURL(/\/login$/)
})

test('platformbeheer maakt een kantoor aan; een gepauzeerd abonnement sluit de data af', async ({
  browser,
}) => {
  const platform = await freshPage(browser)
  await login(platform, PLATFORM_ADMIN, DEMO_PASSWORD)
  await expect(platform).toHaveURL(/\/admin\/sources$/)

  await platform.goto('/admin/agencies')
  const agencyName = `E2E Kantoor ${run}`
  const adminEmail = `beheer-${run}@e2e.test`

  await platform.getByLabel('Naam kantoor', { exact: true }).fill(agencyName)
  await expect(platform.getByLabel('Korte naam')).toHaveValue(`e2e-kantoor-${run}`)
  await platform.getByLabel('E-mail kantoorbeheerder').fill(adminEmail)
  await platform.getByRole('button', { name: 'Kantoor aanmaken' }).click()

  const issued = platform.getByText(`Tijdelijk wachtwoord voor ${adminEmail}`)
  await expect(issued).toBeVisible()
  const temporary = (await issued.locator('xpath=..').locator('code').textContent())?.trim() ?? ''

  // De nieuwe beheerder komt binnen en ziet een leeg maar werkend dashboard.
  const owner = await freshPage(browser)
  await login(owner, adminEmail, temporary)
  await replaceTemporaryPassword(owner, temporary, strongPassword('eigenaar'))
  await expect(owner).toHaveURL(/\/$/)

  // Abonnement pauzeren.
  await platform.reload()
  const row = platform.getByRole('row').filter({ hasText: agencyName })
  await row.getByText('Beheren').click()
  await row.getByLabel('Status').selectOption('PAUSED')
  await row.getByRole('button', { name: 'Abonnement opslaan' }).click()
  await expect(row.getByText('Opgeslagen.')).toBeVisible()

  await owner.goto('/pipeline')
  await expect(owner).toHaveURL(/\/inactief$/)
  await expect(owner.getByText(`Het abonnement van ${agencyName} is niet actief`)).toBeVisible()

  // Heractiveren geeft de toegang terug.
  await row.getByLabel('Status').selectOption('ACTIVE')
  await row.getByRole('button', { name: 'Abonnement opslaan' }).click()
  await expect(row.getByText('Opgeslagen.')).toBeVisible()

  await owner.goto('/pipeline')
  await expect(owner).toHaveURL(/\/pipeline$/)
})

test('publieke pagina’s en health-checks zijn bereikbaar zonder inlog', async ({ page, request }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Privacyverklaring' })).toBeVisible()
  await page.goto('/voorwaarden')
  await expect(page.getByRole('heading', { name: 'Gebruiksvoorwaarden' })).toBeVisible()

  expect((await request.get('/api/health')).status()).toBe(200)
  const ready = await request.get('/api/ready')
  expect(ready.status()).toBe(200)
  expect(await ready.json()).toEqual({ status: 'ready' })
})

test('een onbekend adres en een vergrendeld account geven dezelfde melding', async ({ browser }) => {
  const page = await freshPage(browser)
  await login(page, `bestaat-niet-${run}@e2e.test`, 'wat dan ook')
  await expect(
    page.getByText(
      'Onjuiste combinatie van e-mailadres en wachtwoord. Na herhaalde mislukte pogingen wordt een account tijdelijk vergrendeld.',
    ),
  ).toBeVisible()
})
