// Group policy records into customers. Policies belong to the same customer when the normalised names match
// and their mobile numbers do not conflict (a missing mobile never splits a customer).
import { normalizeNameKey } from './validate.js';
import { isPaid } from './due.js';

export function groupCustomers(policies) {
  const byName = new Map();
  for (const p of policies) {
    const nk = normalizeNameKey(p.customerName) || `~unnamed-${p.mobile || p.policyNumber}`;
    if (!byName.has(nk)) byName.set(nk, []);
    byName.get(nk).push(p);
  }

  const customers = [];
  for (const [nk, list] of byName) {
    const groups = [];
    // Policies with a mobile number create/join groups first; then policies without a mobile join the largest group.
    const sorted = [...list].sort((a, b) => (b.mobile ? 1 : 0) - (a.mobile ? 1 : 0));
    for (const p of sorted) {
      let g = null;
      if (p.mobile) g = groups.find((x) => x.mobiles.has(p.mobile)) || groups.find((x) => x.mobiles.size === 0);
      else g = groups.sort((a, b) => b.policies.length - a.policies.length)[0] || null;
      if (!g) {
        g = { policies: [], mobiles: new Set() };
        groups.push(g);
      }
      g.policies.push(p);
      if (p.mobile) g.mobiles.add(p.mobile);
    }
    groups.forEach((g, i) => {
      const policies = g.policies.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
      const mobile = policies.find((p) => p.mobile)?.mobile || '';
      customers.push({
        key: groups.length > 1 ? `${nk}#${mobile || i}` : nk,
        name: policies[0].customerName || 'Unnamed customer',
        mobile,
        policies,
        policyNumbers: [...new Set(policies.map((p) => p.policyNumber))],
        unpaidCount: policies.filter((p) => !isPaid(p)).length,
        nextDue: policies.filter((p) => !isPaid(p)).map((p) => p.dueDate).sort()[0] || null,
        totalPremiumUnpaid: policies.filter((p) => !isPaid(p)).reduce((s, p) => s + (Number(p.premiumAmount) || 0), 0),
      });
    });
  }
  return customers.sort((a, b) => a.name.localeCompare(b.name));
}

export function findCustomer(customers, key) {
  return customers.find((c) => c.key === key) || null;
}

export function customerKeyOf(customers, policy) {
  return customers.find((c) => c.policies.some((p) => p.id === policy.id))?.key || null;
}
