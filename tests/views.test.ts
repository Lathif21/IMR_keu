/**
 * The reporting views. The most important file here, because everything it
 * covers fails quietly: a wrong subtotal, a period that should not have been
 * consolidated, an elimination applied against revenue that was never added.
 * None of it raises anything. It just prints a different number.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amount, closeDb, entityId, resetFixture, seedPeriod, sql } from './helpers';

interface PnlRow {
  entity_code: string;
  period: string;
  status: string;
  revenue: string;
  cogs: string;
  opex: string;
  other_income: string;
  other_expense: string;
  tax: string;
  gross_profit: string;
  operating_profit: string;
  net_profit: string;
  net_margin_pct: string | null;
}

async function pnl(code: string, period: string): Promise<PnlRow> {
  const rows = await sql<PnlRow>(
    'select * from v_period_pnl where entity_code = $1 and period = $2',
    [code, period]
  );
  if (rows.length === 0) throw new Error(`v_period_pnl kosong untuk ${code} ${period}`);
  return rows[0];
}

let ilj: string;
let tambang: string;
let amdk: string;

beforeAll(async () => {
  await resetFixture();
  ilj = await entityId('ILJ');
  tambang = await entityId('TAMBANG');
  amdk = await entityId('AMDK');
});

afterAll(closeDb);

describe('v_period_pnl', () => {
  it('gross_profit = revenue − cogs', async () => {
    const rows = await sql<PnlRow>('select * from v_period_pnl');
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(amount(row.gross_profit)).toBe(amount(row.revenue) - amount(row.cogs));
      expect(amount(row.operating_profit)).toBe(
        amount(row.revenue) - amount(row.cogs) - amount(row.opex)
      );
      expect(amount(row.net_profit)).toBe(
        amount(row.revenue) -
          amount(row.cogs) -
          amount(row.opex) +
          amount(row.other_income) -
          amount(row.other_expense) -
          amount(row.tax)
      );
    }
  });

  it('laba bersih ILJ Juli 2025 = −2.178.807', async () => {
    const july = await pnl('ILJ', '2025-07-01');
    expect(amount(july.net_profit)).toBe(-2_178_807);
    expect(amount(july.revenue)).toBe(235_000_000);
  });

  it('net_margin_pct kosong saat tidak ada pendapatan, bukan nol', async () => {
    // Zero revenue has no margin. Reporting 0% would read as "broke even".
    await seedPeriod({
      entityCode: 'ILJ',
      period: '2026-01-01',
      lines: [{ line_code: 'OPEX_GAJI', amount: 3_000_000 }]
    });

    const row = await pnl('ILJ', '2026-01-01');
    expect(row.net_margin_pct).toBeNull();
    expect(amount(row.net_profit)).toBe(-3_000_000);
  });

  it('menjumlahkan setiap section ke kolomnya sendiri', async () => {
    const july = await pnl('ILJ', '2025-07-01');
    const [sum] = await sql<{ total: string }>(
      `select coalesce(sum(rl.amount), 0) as total
         from report_lines rl
         join periods p on p.id = rl.period_id
         join report_template_lines tl
           on tl.template_id = p.template_id and tl.line_code = rl.line_code
        where p.id = $1 and tl.section = 'cogs'`,
      [(await sql<{ id: string }>('select id from periods where entity_id = $1 and period = $2', [
        ilj,
        '2025-07-01'
      ]))[0].id]
    );
    expect(amount(july.cogs)).toBe(amount(sum.total));
  });
});

describe('v_group_consolidated', () => {
  it('revenue_consolidated = revenue_sum − elimination', async () => {
    // Both sides approved, so A-10's condition is met and the elimination
    // applies.
    await sql(
      `insert into intercompany_transactions
         (period, seller_entity_id, buyer_entity_id, amount, description)
       values ('2025-07-01', $1, $2, 10000000, 'ILJ mengangkut untuk TAMBANG')`,
      [ilj, tambang]
    );

    const [row] = await sql<{
      revenue_sum: string;
      elimination: string;
      revenue_consolidated: string;
      net_profit_consolidated: string;
    }>("select * from v_group_consolidated where period = '2025-07-01'");

    expect(amount(row.elimination)).toBe(10_000_000);
    expect(amount(row.revenue_consolidated)).toBe(
      amount(row.revenue_sum) - amount(row.elimination)
    );
  });

  it('tidak mengeliminasi saat lawan sisinya belum disetujui', async () => {
    /**
     * AMDK is only `submitted`, so its revenue never entered `revenue_sum`.
     * Eliminating against it would subtract an amount that was never added
     * and push the consolidated figure too low (ASSUMPTIONS.md A-10).
     */
    await sql(
      `insert into intercompany_transactions
         (period, seller_entity_id, buyer_entity_id, amount, description)
       values ('2025-07-01', $1, $2, 7000000, 'ILJ menagih AMDK — AMDK belum disetujui')`,
      [ilj, amdk]
    );

    const [row] = await sql<{ elimination: string }>(
      "select elimination from v_group_consolidated where period = '2025-07-01'"
    );
    expect(amount(row.elimination)).toBe(10_000_000);
  });

  it('mengecualikan periode draft dan submitted dari konsolidasi', async () => {
    const [row] = await sql<{ revenue_sum: string }>(
      "select revenue_sum from v_group_consolidated where period = '2025-07-01'"
    );

    const [approvedOnly] = await sql<{ total: string }>(
      `select coalesce(sum(revenue), 0) as total from v_period_pnl
        where period = '2025-07-01' and status in ('approved', 'locked')`
    );
    const [everything] = await sql<{ total: string }>(
      "select coalesce(sum(revenue), 0) as total from v_period_pnl where period = '2025-07-01'"
    );

    expect(amount(row.revenue_sum)).toBe(amount(approvedOnly.total));
    // AMDK reported 112.750.000 and was never approved — the two must differ,
    // or this test would pass against a view that ignores status entirely.
    expect(amount(everything.total)).toBeGreaterThan(amount(approvedOnly.total));
  });

  it('membawa is_complete dan missing_entities', async () => {
    const [row] = await sql<{ is_complete: boolean; missing_entities: string[] }>(
      "select is_complete, missing_entities from v_group_consolidated where period = '2025-07-01'"
    );

    expect(row.is_complete).toBe(false);
    // AMDK submitted but unapproved; GARAM never reported at all.
    expect([...row.missing_entities].sort()).toEqual(['AMDK', 'GARAM']);
  });

  it('menghitung entitas nonaktif di kedua sisi kelengkapan', async () => {
    // With `is_active` filtered on only one side, a deactivated entity with an
    // approved period makes reported exceed expected: is_complete never turns
    // true and the dashboard reports "−1 belum lapor".
    const rows = await sql<{ expected_entities: string; reported_entities: string }>(
      'select expected_entities, reported_entities from v_period_completeness'
    );
    for (const row of rows) {
      expect(Number(row.reported_entities)).toBeLessThanOrEqual(Number(row.expected_entities));
    }
  });
});

describe('v_period_comparison', () => {
  it('revenue_mom_pct membandingkan bulan sebelumnya', async () => {
    const [row] = await sql<{
      revenue: string;
      revenue_prev_month: string;
      revenue_mom_pct: string;
    }>(
      `select revenue, revenue_prev_month, revenue_mom_pct
         from v_period_comparison
        where entity_id = $1 and period = '2025-07-01'`,
      [ilj]
    );

    // Deliberately different figures: 241.500.000 in June, 235.000.000 in July.
    expect(amount(row.revenue_prev_month)).toBe(241_500_000);
    expect(amount(row.revenue_mom_pct)).toBeCloseTo(-2.69, 1);
  });

  it('revenue_yoy_pct kosong tanpa data 12 bulan sebelumnya', async () => {
    const rows = await sql<{ revenue_yoy_pct: string | null }>(
      'select revenue_yoy_pct from v_period_comparison'
    );
    expect(rows.every((row) => row.revenue_yoy_pct === null)).toBe(true);
  });

  it('MoM dan YoY adalah kolom yang berbeda, bukan nama lain untuk hal yang sama', async () => {
    /**
     * The prototype labelled month-over-month as "YoY". Adding July 2024 with
     * a deliberately different revenue makes the two columns disagree — if one
     * were an alias for the other, they could not.
     */
    await seedPeriod({
      entityCode: 'ILJ',
      period: '2024-07-01',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 100_000_000 }]
    });

    const [row] = await sql<{
      revenue_mom_pct: string;
      revenue_yoy_pct: string;
      revenue_prev_month: string;
      revenue_prev_year: string;
    }>(
      `select revenue_mom_pct, revenue_yoy_pct, revenue_prev_month, revenue_prev_year
         from v_period_comparison
        where entity_id = $1 and period = '2025-07-01'`,
      [ilj]
    );

    expect(amount(row.revenue_prev_month)).toBe(241_500_000);
    expect(amount(row.revenue_prev_year)).toBe(100_000_000);
    expect(amount(row.revenue_mom_pct)).toBeCloseTo(-2.69, 1);
    expect(amount(row.revenue_yoy_pct)).toBeCloseTo(135.0, 1);
    expect(amount(row.revenue_mom_pct)).not.toBe(amount(row.revenue_yoy_pct));
  });
});

describe('kode baris tak dikenal', () => {
  it('tidak dapat masuk lewat jalur mana pun, jadi view tidak pernah kehilangan angka', async () => {
    // The failure this prevents is silent: an unknown code joins to a NULL
    // section and the amount vanishes from every bucket at once.
    const [row] = await sql<{ orphans: string }>(
      `select count(*) as orphans
         from report_lines rl
         join periods p on p.id = rl.period_id
         left join report_template_lines tl
                on tl.template_id = p.template_id and tl.line_code = rl.line_code
        where tl.line_code is null`
    );
    expect(Number(row.orphans)).toBe(0);
  });
});
