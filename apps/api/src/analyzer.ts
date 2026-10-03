import { randomUUID } from 'node:crypto';
import { zeroAddress, isAddress } from 'viem';
import {
  RULES_VERSION,
  NETWORKS,
  explorerLink,
  safeUrl,
  type Report,
  type ProviderResult,
  type ScanInput,
  type Evidence,
  type Json,
  type Finding,
  type Severity,
  type Pair,
  type TimelineEvent,
} from '@coinchecker/shared';
import { arr, obj, str, num, flag, json } from './providers.js';

export function analyze(input: ScanInput, sources: ProviderResult[], cacheSeconds = 60): Report {
  const source = (id: ProviderResult['source']) => sources.find((s) => s.source === id);
  const data = (id: ProviderResult['source']) => obj(source(id)?.data);
  const g = data('goplus'),
    h = ['ok', 'partial'].includes(source('honeypot')?.status || '') ? data('honeypot') : {},
    r = data('rpc'),
    e = data('etherscan'),
    cg = data('coingecko');
  const evidence: Evidence[] = [],
    findings: Finding[] = [];
  const ev = (sourceId: ProviderResult['source'], field: string, value: unknown) => {
    const id = `${sourceId}:${field}`;
    if (!evidence.some((v) => v.id === id))
      evidence.push({
        id,
        source: sourceId,
        field,
        value: json(value ?? null),
        observedAt: source(sourceId)?.checkedAt || new Date().toISOString(),
        blockNumber: sourceId === 'rpc' ? str(r.blockNumber) || undefined : undefined,
        url: explorerLink(input.chainId, 'address', input.address),
      });
    return id;
  };
  const finding = (
    id: string,
    severity: Severity,
    title: string,
    explanation: string,
    limitations: string,
    sourceId: ProviderResult['source'],
    field: string,
    value: unknown,
  ) =>
    findings.push({
      id,
      severity,
      title,
      explanation,
      limitations,
      evidenceIds: [ev(sourceId, field, value)],
    });
  if (flag(obj(h.honeypotResult).isHoneypot) === true)
    finding(
      'honeypot',
      'critical',
      'Honeypot result reported',
      'Honeypot.is reports that this token behaves as a honeypot on its assessed route. Inspect the provider result and route.',
      'A provider conclusion is not a guarantee about every possible transaction or route.',
      'honeypot',
      'honeypotResult',
      h.honeypotResult,
    );
  if (flag(g.is_honeypot) === true)
    finding(
      'goplus_honeypot',
      'critical',
      'Honeypot flag reported',
      'GoPlus flags this token as a honeypot.',
      'This is a provider-reported result; the recorded response may not include a reproducible transaction trace.',
      'goplus',
      'is_honeypot',
      g.is_honeypot,
    );
  if (flag(g.cannot_sell_all) === true)
    finding(
      'cannot_sell_all',
      'high',
      'Selling restrictions reported',
      'GoPlus reports a restriction on selling the full token balance.',
      'The exact affected amounts, callers, and trading routes are not established by this flag alone.',
      'goplus',
      'cannot_sell_all',
      g.cannot_sell_all,
    );
  if (flag(g.cannot_buy) === true)
    finding(
      'cannot_buy',
      'high',
      'Buying restrictions reported',
      'The provider reports that buying is restricted.',
      'This may depend on trading status, callers, and route; it does not independently establish fraud.',
      'goplus',
      'cannot_buy',
      g.cannot_buy,
    );
  if (flag(g.transfer_pausable) === true)
    finding(
      'pause_control',
      'caution',
      'Transfers may be paused',
      'GoPlus reports a capability to pause token transfers.',
      'The controlling role and its restrictions are not established by this flag. Legitimate tokens can include pause controls.',
      'goplus',
      'transfer_pausable',
      g.transfer_pausable,
    );
  const controls = [
    [
      'is_mintable',
      'mint_control',
      'Minting capability reported',
      'The provider reports that the supply can be increased.',
    ],
    [
      'is_blacklisted',
      'blacklist_control',
      'Blacklist capability reported',
      'The provider reports that holders can be restricted by a blacklist.',
    ],
    [
      'slippage_modifiable',
      'fee_control',
      'Transfer fees may be changed',
      'The provider reports modifiable transfer or trading fees.',
    ],
    [
      'hidden_owner',
      'hidden_owner',
      'Hidden administrative control reported',
      'The provider reports an administrative control outside the visible ownership field.',
    ],
    [
      'owner_change_balance',
      'balance_control',
      'Balances may be changed by an administrator',
      'The provider reports a capability to modify holder balances.',
    ],
    [
      'selfdestruct',
      'selfdestruct',
      'Destructive contract capability reported',
      'The provider reports a self-destruct capability; its effective behavior depends on chain rules and the implementation.',
    ],
  ] as const;
  for (const [field, id, title, explanation] of controls)
    if (flag(g[field]) === true)
      finding(
        id,
        field === 'owner_change_balance' ? 'high' : 'caution',
        title,
        explanation,
        'This capability alone does not prove malicious intent. Current authority, role restrictions, and implementation must be reviewed.',
        'goplus',
        field,
        g[field],
      );
  if (flag(g.is_proxy) === true || str(r.implementation) || flag(obj(e.source).Proxy) === true)
    finding(
      'proxy',
      'caution',
      'Proxy implementation needs review',
      'This token uses a proxy or has a detected implementation address.',
      'A proxy does not by itself prove that an administrator can upgrade it; upgrade authority needs separate verification.',
      str(r.implementation) ? 'rpc' : flag(g.is_proxy) === true ? 'goplus' : 'etherscan',
      str(r.implementation)
        ? 'implementation'
        : flag(g.is_proxy) === true
          ? 'is_proxy'
          : 'source.Proxy',
      r.implementation || g.is_proxy || obj(e.source).Proxy,
    );
  const tax = (value: unknown, multiplier = 1) => {
    const n = num(value);
    return n !== null && n >= 0 && n * multiplier <= 100 ? n * multiplier : null;
  };
  const simulation = obj(h.simulationResult),
    sellTax = h.simulationSuccess === true ? tax(simulation.sellTax) : tax(g.sell_tax, 100),
    buyTax = h.simulationSuccess === true ? tax(simulation.buyTax) : tax(g.buy_tax, 100);
  if (sellTax !== null && sellTax >= 10)
    finding(
      'sell_tax',
      sellTax >= 50 ? 'high' : 'caution',
      'Elevated observed sell tax',
      `The recorded ${h.simulationSuccess === true ? 'simulation' : 'provider'} result shows a ${sellTax.toFixed(2)}% sell tax.`,
      'Taxes are an observation at the checked time and route and may change.',
      h.simulationSuccess === true ? 'honeypot' : 'goplus',
      h.simulationSuccess === true ? 'simulationResult.sellTax' : 'sell_tax',
      h.simulationSuccess === true ? simulation.sellTax : g.sell_tax,
    );
  if (buyTax !== null && buyTax >= 10)
    finding(
      'buy_tax',
      buyTax >= 50 ? 'high' : 'caution',
      'Elevated observed buy tax',
      `The recorded result shows a ${buyTax.toFixed(2)}% buy tax.`,
      'Taxes are route- and time-dependent.',
      h.simulationSuccess === true ? 'honeypot' : 'goplus',
      h.simulationSuccess === true ? 'simulationResult.buyTax' : 'buy_tax',
      h.simulationSuccess === true ? simulation.buyTax : g.buy_tax,
    );
  if (h.simulationSuccess === false)
    finding(
      'simulation_incomplete',
      'unknown',
      'Trading simulation did not complete',
      'The simulation returned an error or could not establish a result. This is not automatically proof of a selling restriction.',
      'Review the recorded simulation error, pair, and any separately reported honeypot result.',
      'honeypot',
      'simulationError',
      h.simulationError || source('honeypot')?.message,
    );
  if (source('honeypot')?.status === 'unsupported')
    finding(
      'simulation_unsupported',
      'unknown',
      'Trading route is not established',
      source('honeypot')?.message || 'The simulation route is unsupported.',
      'An unsupported or inconsistent test does not establish a pass or a honeypot. The raw response remains available.',
      'honeypot',
      'route_coverage',
      source('honeypot')?.message,
    );
  const contractSource = obj(e.source),
    creation = obj(e.creation),
    metadata = obj(cg.metadata);
  const verified = str(contractSource.SourceCode, 2) ? true : flag(g.is_open_source);
  if (verified === false)
    finding(
      'source_unverified',
      'caution',
      'Source availability is limited',
      'The available provider reports that contract source is not open or verified.',
      'Source verification is separate from an audit and does not establish safety.',
      'goplus',
      'is_open_source',
      g.is_open_source,
    );
  if (flag(r.isContract) === false)
    finding(
      'not_contract',
      'unknown',
      'No deployed contract found',
      'The RPC returned no contract bytecode at this address on the selected network.',
      'Check the network and exact contract address. This result does not identify a token.',
      'rpc',
      'isContract',
      false,
    );
  const pairs: Pair[] = arr(source('dexscreener')?.data)
    .map((v) => {
      const p = obj(v),
        base = obj(p.baseToken),
        quote = obj(p.quoteToken),
        created = num(p.pairCreatedAt);
      return {
        address: str(p.pairAddress) || '',
        dex: str(p.dexId) || 'Unknown',
        label: [
          str(base.symbol) || 'Token',
          str(quote.symbol) || 'Token',
          str(p.dexId) || 'DEX',
          ...arr(p.labels).filter((v) => typeof v === 'string'),
        ].join(' / '),
        url: safeUrl(p.url) || explorerLink(input.chainId, 'address', input.address),
        priceUsd:
          str(base.address)?.toLowerCase() === input.address.toLowerCase() ? num(p.priceUsd) : null,
        priceChange24h:
          str(base.address)?.toLowerCase() === input.address.toLowerCase()
            ? num(obj(p.priceChange).h24)
            : null,
        liquidityUsd: num(obj(p.liquidity).usd),
        volume24h: num(obj(p.volume).h24),
        marketCap:
          str(base.address)?.toLowerCase() === input.address.toLowerCase()
            ? num(p.marketCap)
            : null,
        fdv: str(base.address)?.toLowerCase() === input.address.toLowerCase() ? num(p.fdv) : null,
        createdAt:
          created !== null && created > 0 && created <= Date.now()
            ? new Date(created).toISOString()
            : null,
        baseSymbol: str(base.symbol) || '',
        quoteSymbol: str(quote.symbol) || '',
      };
    })
    .filter((p) => isAddress(p.address))
    .sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1));
  const selectedPair =
    (input.pairAddress
      ? pairs.find((p) => p.address.toLowerCase() === input.pairAddress!.toLowerCase())
      : pairs[0]) || null;
  if (
    selectedPair?.liquidityUsd !== null &&
    selectedPair?.liquidityUsd !== undefined &&
    selectedPair.liquidityUsd < 20000
  )
    finding(
      'low_liquidity',
      'caution',
      'Limited pool liquidity',
      `The selected indexed pool has $${Math.round(selectedPair.liquidityUsd).toLocaleString('en-US')} liquidity.`,
      'Liquidity is pool-specific and can change; low liquidity alone does not establish fraud.',
      'dexscreener',
      'selectedPair.liquidityUsd',
      selectedPair.liquidityUsd,
    );
  const holders = arr(g.holders).map(obj),
    concentration = holders
      .filter(
        (v) =>
          flag(v.is_contract) !== true &&
          typeof v.address === 'string' &&
          !['0x000000000000000000000000000000000000dead', zeroAddress].includes(
            v.address.toLowerCase(),
          ),
      )
      .reduce<number | null>((max, v) => {
        const percent = num(v.percent);
        return percent !== null && percent >= 0 && percent <= 1
          ? Math.max(max ?? 0, percent * 100)
          : max;
      }, null);
  if (concentration !== null && concentration >= 20)
    finding(
      'holder_concentration',
      'caution',
      'Concentrated holder balance',
      `A reported holder controls approximately ${concentration.toFixed(1)}% of supply.`,
      'Address labels, custodians, vesting arrangements, and incomplete holder coverage can affect interpretation.',
      'goplus',
      'holders',
      g.holders,
    );
  const isV3 =
    /v3|v4/i.test(selectedPair?.label || '') ||
    /UniswapV3/i.test(str(obj(obj(h.pair).pair).type) || '');
  const lp = arr(g.lp_holders).map(obj);
  let liquidityLockedPercent: number | null = null;
  const securityPools = arr(g.dex).map(obj),
    lpMatchesPool =
      securityPools.length === 1 &&
      str(securityPools[0]?.pair)?.toLowerCase() === selectedPair?.address.toLowerCase();
  if (!isV3 && lp.length && lpMatchesPool) {
    const known = lp.every(
      (v) =>
        num(v.percent) !== null &&
        num(v.percent)! >= 0 &&
        num(v.percent)! <= 1 &&
        flag(v.is_locked) !== null,
    );
    if (known) {
      const total = lp
        .filter((v) => flag(v.is_locked) === true)
        .reduce((sum, v) => sum + (num(v.percent) ?? 0) * 100, 0);
      if (total <= 100) liquidityLockedPercent = total;
    }
  }
  if (liquidityLockedPercent !== null) ev('goplus', 'lp_holders', g.lp_holders);
  const history: TimelineEvent[] = arr(r.events).map((v) => {
    const log = obj(v),
      args = obj(log.args),
      event = str(log.event) || 'Contract event',
      tx = str(log.transactionHash),
      block = str(log.blockNumber) || undefined;
    return {
      id: str(log.id) || randomUUID(),
      kind: 'onchain',
      title:
        event === 'Transfer'
          ? str(args.from)?.toLowerCase() === zeroAddress
            ? 'Mint transfer event'
            : 'Burn transfer event'
          : event,
      description:
        event === 'OwnershipTransferred'
          ? `Owner changed from ${str(args.previousOwner) || 'unknown'} to ${str(args.newOwner) || 'unknown'}.`
          : event === 'RoleGranted' || event === 'RoleRevoked'
            ? `${event === 'RoleGranted' ? 'Granted' : 'Revoked'} role ${str(args.role) || 'unknown'} for ${str(args.account) || 'unknown'}.`
            : event === 'Upgraded'
              ? `Implementation: ${str(args.implementation) || 'unknown'}`
              : event === 'Transfer'
                ? `Raw token amount: ${str(args.value) || 'unknown'} (decimals not applied).`
                : 'Recorded contract event.',
      timestamp: str(log.timestamp),
      blockNumber: block,
      transactionHash: tx || undefined,
      url: tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? explorerLink(input.chainId, 'tx', tx) : undefined,
      source: 'rpc',
      details: json(args),
    };
  });
  const deployedSeconds = num(creation.timestamp),
    deployedAt =
      deployedSeconds !== null && deployedSeconds > 0 && deployedSeconds * 1000 <= Date.now()
        ? new Date(deployedSeconds * 1000).toISOString()
        : null,
    deployTx = str(creation.txHash);
  if (deployTx && /^0x[0-9a-fA-F]{64}$/.test(deployTx))
    history.push({
      id: 'deployment',
      kind: 'onchain',
      title: 'Contract deployed',
      description:
        'Deployment transaction reported by Etherscan. This is separate from pool creation.',
      timestamp: deployedAt,
      transactionHash: deployTx,
      blockNumber: str(creation.blockNumber) || undefined,
      url: explorerLink(input.chainId, 'tx', deployTx),
      source: 'etherscan',
    });
  if (selectedPair?.createdAt)
    history.push({
      id: `pool:${selectedPair.address}`,
      kind: 'market',
      title: 'Pool first indexed',
      description: `${selectedPair.label}. This pool timestamp is not the token deployment date.`,
      timestamp: selectedPair.createdAt,
      url: selectedPair.url,
      source: 'dexscreener',
    });
  const coreFlags = [
    'is_honeypot',
    'cannot_sell_all',
    'is_mintable',
    'is_blacklisted',
    'slippage_modifiable',
    'transfer_pausable',
  ];
  const securityEstablished =
    coreFlags.every((f) => flag(g[f]) !== null) &&
    h.simulationSuccess === true &&
    flag(obj(h.honeypotResult).isHoneypot) === false &&
    flag(r.isContract) === true;
  const verdict = findings.some((f) => f.severity === 'critical')
    ? 'critical'
    : findings.some((f) => f.severity === 'high')
      ? 'high'
      : findings.some((f) => f.severity === 'caution')
        ? 'caution'
        : securityEstablished
          ? 'no_major_issues'
          : 'insufficient_data';
  const limitations = sources
    .filter((s) => s.status !== 'ok')
    .map((s) => `${s.source}: ${s.message || s.status}`);
  if (isV3)
    limitations.push(
      'Concentrated-liquidity positions require position-specific lock analysis; fungible LP lock percentages are not applied.',
    );
  if (liquidityLockedPercent === null)
    limitations.push(
      'Liquidity locking and controlling positions are not established for the selected pool.',
    );
  if (!securityEstablished)
    limitations.push(
      'Some core security checks are unknown or incomplete. Missing information is not a passed check.',
    );
  const completed = sources.filter((s) => s.status === 'ok').length;
  const checkedAt = new Date().toISOString();
  const cleanDescription =
    (str(obj(metadata.description).en, 10000) || '').replace(/<[^>]*>/g, '').trim() || null;
  const urls = (v: unknown) =>
    arr(v)
      .map(safeUrl)
      .filter((u): u is string => Boolean(u))
      .slice(0, 10);
  const chart = obj(cg.chart);
  const prices = arr(chart.prices)
    .map((v) => arr(v))
    .filter((v) => v.length === 2 && num(v[0]) !== null && num(v[1]) !== null)
    .map((v) => [Number(v[0]), Number(v[1])] as [number, number])
    .slice(-500);
  return {
    id: randomUUID(),
    chainId: input.chainId,
    address: input.address,
    pairAddress: input.pairAddress,
    name:
      str(r.name) ||
      str(g.token_name) ||
      str(obj(h.token).name) ||
      str(metadata.name) ||
      'Unidentified token',
    symbol:
      str(r.symbol, 24) ||
      str(g.token_symbol, 24) ||
      str(obj(h.token).symbol, 24) ||
      str(metadata.symbol, 24) ||
      'TOKEN',
    checkedAt,
    expiresAt: new Date(Date.now() + cacheSeconds * 1000).toISOString(),
    rulesVersion: RULES_VERSION,
    verdict,
    coverage: {
      label:
        completed === sources.length && securityEstablished && liquidityLockedPercent !== null
          ? 'complete'
          : completed === 0
            ? 'insufficient'
            : 'partial',
      completed,
      total: sources.length,
      limitations,
    },
    findings,
    evidence,
    sources,
    pairs,
    selectedPair,
    contract: {
      verified: verified ?? null,
      implementation:
        [str(contractSource.Implementation), str(r.implementation)].find(
          (a) => a && isAddress(a),
        ) || null,
      owner: str(r.owner) || str(g.owner_address),
      isContract: flag(r.isContract),
      deployedAt,
      creator: str(creation.contractCreator) || str(g.creator_address),
      deploymentTx: deployTx,
      compiler: str(contractSource.CompilerVersion),
      audit: 'not_established',
    },
    history: history.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')),
    historyCoverage: {
      fromBlock: str(r.fromBlock),
      toBlock: str(r.toBlock),
      complete: false,
      note:
        str(r.historyNote, 500) ||
        'On-chain event history is unavailable; recorded scans are separate observations.',
    },
    project: {
      description: cleanDescription,
      websites: urls(obj(metadata.links).homepage),
      repositories: urls(obj(obj(metadata.links).repos_url).github),
      logo: safeUrl(obj(metadata.image).small),
      provenance:
        'Third-party metadata. Descriptions and links may originate from project-provided claims; they are not verified on-chain facts.',
      prices,
    },
    metrics: {
      buyTax,
      sellTax,
      holderCount: num(g.holder_count) ?? num(obj(h.token).totalHolders),
      topHolderPercent: concentration,
      liquidityLockedPercent,
    },
  };
}
