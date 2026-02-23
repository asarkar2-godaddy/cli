/**
 * Core type definitions shared across CLI modules
 */

// Generic result wrapper for synchronous utility functions
export interface Result<T = unknown> {
	success: boolean;
	data?: T;
	error?: Error;
}
