import type { Locales } from '$i18n/i18n-types';

export interface Model {
	serverId: string;
	name: string;
	size?: number;
	parameterSize?: string;
	modifiedAt?: Date;
}

export interface Settings {
	models: Model[];
	lastUsedModels: Model[];
	userTheme: 'light' | 'dark';
	userLanguage: Locales | null;
	sidebarExpanded: boolean;
	globalSystemPrompt?: string;
}

export const DEFAULT_SETTINGS: Settings = {
	models: [],
	lastUsedModels: [],
	userTheme: 'light',
	userLanguage: null,
	sidebarExpanded: true
};
