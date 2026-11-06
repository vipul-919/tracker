import { z } from 'zod';
import { categories } from '../shared/tracking.js';
const text = (max) => z.string().trim().min(1).max(max);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === v && +v.slice(0, 4) >= 1900 && +v.slice(0, 4) <= 2200; }, 'Enter a valid calendar date');
export const id = z.string().regex(/^[a-f\d]{24}$/i);
export const websiteInput = z.object({ name: text(120), url: z.string().trim().url().max(2048).refine(v => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS URL'), description: z.string().trim().max(2000).default(''), defaultMonthlyHours: z.number().min(0).max(744).refine(v => Number.isInteger(v * 60), 'Use whole minutes'), startDate: date, status: z.enum(['Active', 'Inactive']) });
export const logInput = z.object({ websiteId: id, date, description: text(2000), category: z.enum(categories), hours: z.number().int().min(0).max(24), minutes: z.number().int().min(0).max(59), notes: z.string().trim().max(5000).default('') }).refine(v => v.hours * 60 + v.minutes > 0 && v.hours * 60 + v.minutes <= 1440, 'Time must be between 1 minute and 24 hours');
export const allocationInput = z.object({ websiteId: id, month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(2200), allocatedHours: z.number().min(0).max(744).refine(v => Number.isInteger(v * 60), 'Use whole minutes') });
export const credentials = z.object({ email: z.string().trim().min(1).max(254).transform(v => v.toLowerCase()), password: z.string().min(10).max(128) });
export const registration = credentials.extend({ name: text(100) });
const email = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const username = z.string().trim().max(40).regex(/^[a-zA-Z0-9._-]*$/).transform(value => value.toLowerCase() || undefined).optional();
export const bootstrapInput = z.object({ name: text(100), email, password: z.string().min(12).max(128) });
export const managedUserInput = z.object({
	name: text(100),
	email,
	username,
	password: z.string().min(12).max(128),
	role: z.enum(['editor', 'viewer']),
  sendInvitation: z.boolean().default(false),
	status: z.enum(['active', 'inactive']),
});
export const managedUserUpdateInput = z.object({
	name: text(100).optional(),
	email: email.optional(),
	username,
	role: z.enum(['admin', 'editor', 'viewer']).optional(),
	status: z.enum(['active', 'inactive']).optional(),
}).refine(value => Object.keys(value).length > 0, 'Provide at least one user field to update');
export const passwordChangeInput = z.object({ currentPassword: z.string().min(1).max(128).optional(), newPassword: z.string().min(12).max(128) });
export const forgotPasswordInput = z.object({ email });
export const resetPasswordInput = z.object({ email, code: z.string().regex(/^\d{8}$/), password: z.string().min(12).max(128) });
