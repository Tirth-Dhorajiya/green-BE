const EVIDENCE_REASONS = new Set(['damaged', 'dead', 'missing', 'wrong_item']);
const DAMAGE_ONLY_REASONS = new Set(['damaged', 'dead', 'missing', 'wrong_item']);
const VALID_REASONS = new Set([
  'damaged', 'dead', 'defective', 'missing', 'wrong_item', 'not_as_described', 'change_of_mind',
]);

const toPaise = (value) => Math.round(Number(value || 0) * 100);

const allocateNetUnitAmounts = ({ items, subtotal, discount }) => {
  const subtotalPaise = toPaise(subtotal);
  const discountPaise = Math.min(toPaise(discount), subtotalPaise);
  if (!items.length) return [];

  const grossLines = items.map((item) => toPaise(item.price) * Number(item.quantity));
  const grossTotal = grossLines.reduce((sum, value) => sum + value, 0) || subtotalPaise;
  let allocated = 0;
  const shares = grossLines.map((gross, index) => {
    if (index === grossLines.length - 1) return discountPaise - allocated;
    const share = Math.floor((discountPaise * gross) / Math.max(grossTotal, 1));
    allocated += share;
    return share;
  });

  return items.map((item, index) => {
    const quantity = Number(item.quantity);
    const netLinePaise = Math.max(0, grossLines[index] - shares[index]);
    return {
      ...item,
      netLinePaise,
      netUnitPaise: Math.floor(netLinePaise / quantity),
      remainderPaise: netLinePaise % quantity,
    };
  });
};

const refundableAmountForQuantity = (item, quantity) => {
  const requested = Number(quantity);
  const purchased = Number(item.quantity);
  const netLinePaise = item.net_line_paise !== undefined
    ? Number(item.net_line_paise)
    : toPaise(item.net_unit_amount || item.price) * purchased;
  if (requested >= purchased) return netLinePaise;
  return Math.floor((netLinePaise * requested) / purchased);
};

const evaluateItemEligibility = ({ item, reason, deliveredAt, now = new Date() }) => {
  if (!VALID_REASONS.has(reason)) return { eligible: false, message: 'Invalid return reason' };
  if (!deliveredAt) return { eligible: false, message: 'The order has not been delivered' };

  const policy = item.return_policy_snapshot || 'returnable';
  const windowHours = Number(item.return_window_hours_snapshot || 168);
  const deadline = new Date(new Date(deliveredAt).getTime() + windowHours * 60 * 60 * 1000);
  if (now > deadline) return { eligible: false, message: 'The return window has closed', deadline };
  if ((item.final_sale_snapshot || policy === 'damage_only') && !DAMAGE_ONLY_REASONS.has(reason)) {
    return { eligible: false, message: 'This product only supports damage, missing, or incorrect-item claims', deadline };
  }
  if ((item.category_snapshot || '').toLowerCase() === 'plants' && !DAMAGE_ONLY_REASONS.has(reason)) {
    return { eligible: false, message: 'Live plants cannot be returned for this reason', deadline };
  }
  return {
    eligible: true,
    deadline,
    evidenceRequired: EVIDENCE_REASONS.has(reason),
    reverseRequired: !['missing'].includes(reason) && !((item.category_snapshot || '').toLowerCase() === 'plants' && ['damaged', 'dead'].includes(reason)),
  };
};

module.exports = {
  VALID_REASONS,
  EVIDENCE_REASONS,
  toPaise,
  allocateNetUnitAmounts,
  refundableAmountForQuantity,
  evaluateItemEligibility,
};
