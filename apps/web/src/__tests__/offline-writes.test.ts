// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canQueueOffline, describeOfflineAction, isQueuedOffline, OFFLINE_QUEUED } from '@forge/shared'

describe('écritures hors ligne — ce qui peut attendre', () => {
  it.each([
    ['POST',   '/api/clients'],
    ['PUT',    '/api/clients/42'],
    ['DELETE', '/api/clients/42'],
    ['POST',   '/api/devis'],
    ['PUT',    '/api/devis/7'],
    ['POST',   '/api/stocks'],
    ['POST',   '/api/stocks/12/mouvement'],
    ['POST',   '/api/bons'],
    ['PATCH',  '/api/bons/3/preparation'],
    ['POST',   '/api/factures'],
    ['POST',   '/api/factures/9/versements'],      // encaissement en espèces
    ['POST',   '/api/credits/5/rembourser'],
    ['POST',   '/api/rh/presences'],
    ['PATCH',  '/api/production/jobs/4/avancement'],
    ['POST',   '/api/projets/1/taches'],
    ['DELETE', '/api/fournisseurs/8'],
  ])('%s %s → mis en file', (method, path) => {
    expect(canQueueOffline(method, path)).toBe(true)
  })

  it.each([
    // validations et approbations
    ['PUT',   '/api/bons/3/valider'],
    ['PUT',   '/api/bons/3/executer'],
    ['PATCH', '/api/devis/7/statut'],
    ['POST',  '/api/devis/7/decision-client'],
    ['POST',  '/api/devis/7/transformer-commande'],
    ['PATCH', '/api/commandes/2/statut'],
    ['POST',  '/api/rh/paie/6/valider'],
    ['PATCH', '/api/sorties-tresorerie/1/annuler'],
    // mobile money, mots de passe, PIN, comptes et droits
    ['POST',  '/api/paiements/initier'],
    ['POST',  '/api/profile/pin'],
    ['PATCH', '/api/profile/password-changed'],
    ['POST',  '/api/admin/users/invite'],
    ['PATCH', '/api/admin/rbac/roles/3/permissions'],
    ['POST',  '/api/credit/limits'],
    // la Caisse a sa propre file ; calculs et traitements serveur
    ['POST',  '/api/caisse/tickets'],
    ['POST',  '/api/devis/calculate'],
    ['POST',  '/api/factures/synchroniser-commandes'],
    ['POST',  '/api/bons/appro/4/reception'],
    // fichiers
    ['POST',  '/api/charges/2/justificatifs'],
  ])('%s %s → en ligne uniquement', (method, path) => {
    expect(canQueueOffline(method, path)).toBe(false)
  })

  it('ne met jamais une lecture en file', () => {
    expect(canQueueOffline('GET', '/api/clients')).toBe(false)
  })

  it('refuse une action enchaînée sur un élément sans identifiant', () => {
    expect(canQueueOffline('POST', '/api/rh/apprenants/undefined/inscrire')).toBe(false)
    expect(canQueueOffline('PUT', '/api/clients/null')).toBe(false)
  })

  it('ignore la chaîne de requête et la barre finale', () => {
    expect(canQueueOffline('POST', '/api/clients/?source=form')).toBe(true)
    expect(canQueueOffline('PATCH', '/api/devis/7/statut?x=1')).toBe(false)
  })

  it('donne un libellé lisible', () => {
    expect(describeOfflineAction('POST', '/api/clients')).toBe('Création — Client')
    expect(describeOfflineAction('DELETE', '/api/devis/7')).toBe('Suppression — Devis')
    expect(describeOfflineAction('POST', '/api/factures/9/versements')).toBe('Versement sur facture')
    expect(describeOfflineAction('POST', '/api/stocks/12/mouvement')).toBe('Mouvement de stock')
  })

  it('reconnaît le marqueur de mise en file', () => {
    expect(isQueuedOffline(OFFLINE_QUEUED)).toBe(true)
    expect(isQueuedOffline({ id: 'x' })).toBe(false)
    expect(isQueuedOffline(undefined)).toBe(false)
  })
})
