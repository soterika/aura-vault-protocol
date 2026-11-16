import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from '../components/ds';

// ── Textarea ──────────────────────────────────────────────────────────────
const textareaMeta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: { label: 'Transaction Notes', placeholder: 'Optional memo for this transaction…' },
};
export default textareaMeta;
type TextareaStory = StoryObj<typeof Textarea>;

export const Default:     TextareaStory = {};
export const AutoResize:  TextareaStory = { args: { autoResize: true, helperText: 'Expands as you type' } };
export const WithError:   TextareaStory = { args: { error: 'Note cannot exceed 256 characters' } };
export const Disabled:    TextareaStory = { args: { disabled: true, value: 'Yield harvest from pool #3' } };
