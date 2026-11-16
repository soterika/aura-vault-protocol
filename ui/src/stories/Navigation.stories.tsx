import type { Meta } from '@storybook/react';
import { useState } from 'react';
import { Tabs, TabList, Tab, TabPanels, TabPanel, Breadcrumb, Pagination, Stack } from '../components/ds';

// ── Tabs ──────────────────────────────────────────────────────────────────
const tabsMeta: Meta = {
  title: 'Navigation/Tabs',
  tags: ['autodocs'],
};
export default tabsMeta;

export const VaultTabs = {
  render: () => (
    <Tabs defaultTab="deposit">
      <TabList aria-label="Vault actions">
        <Tab id="deposit">Deposit</Tab>
        <Tab id="withdraw">Withdraw</Tab>
        <Tab id="harvest">Harvest</Tab>
      </TabList>
      <TabPanels>
        <TabPanel id="deposit"><p style={{ padding: 'var(--sp-4)', color: 'var(--color-text-muted)' }}>Deposit USDC into the vault to start earning yield.</p></TabPanel>
        <TabPanel id="withdraw"><p style={{ padding: 'var(--sp-4)', color: 'var(--color-text-muted)' }}>Burn your vault shares to redeem underlying tokens.</p></TabPanel>
        <TabPanel id="harvest"><p style={{ padding: 'var(--sp-4)', color: 'var(--color-text-muted)' }}>Inject yield into the vault without minting new shares.</p></TabPanel>
      </TabPanels>
    </Tabs>
  ),
};

// ── Breadcrumb ────────────────────────────────────────────────────────────
export const BreadcrumbStory = {
  title: 'Navigation/Breadcrumb',
  render: () => (
    <Stack gap={4}>
      <Breadcrumb items={[{ label: 'Home', href: '#' }, { label: 'Vaults', href: '#' }, { label: 'USDC Vault' }]} />
      <Breadcrumb items={[{ label: 'Dashboard', href: '#' }, { label: 'Settings' }]} />
    </Stack>
  ),
};

// ── Pagination ────────────────────────────────────────────────────────────
export const PaginationStory = {
  title: 'Navigation/Pagination',
  render: () => {
    const [page, setPage] = useState(3);
    return (
      <Stack gap={6} align="center">
        <Pagination currentPage={page} totalPages={10} onPageChange={setPage} />
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Page {page} of 10</p>
      </Stack>
    );
  },
};
