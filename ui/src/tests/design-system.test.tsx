import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from '../components/ds';

describe('design system navigation', () => {
  it('updates the active tab when navigating with arrow keys', async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultTab="overview">
        <TabList aria-label="Example tabs">
          <Tab id="overview">Overview</Tab>
          <Tab id="activity">Activity</Tab>
          <Tab id="settings">Settings</Tab>
        </TabList>
        <TabPanels>
          <TabPanel id="overview">Overview content</TabPanel>
          <TabPanel id="activity">Activity content</TabPanel>
          <TabPanel id="settings">Settings content</TabPanel>
        </TabPanels>
      </Tabs>
    );

    const firstTab = screen.getByRole('tab', { name: 'Overview' });
    firstTab.focus();

    await user.keyboard('{ArrowRight}');

    const secondTab = screen.getByRole('tab', { name: 'Activity' });
    expect(secondTab).toHaveFocus();
    expect(secondTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Activity content')).toBeInTheDocument();
  });
});
