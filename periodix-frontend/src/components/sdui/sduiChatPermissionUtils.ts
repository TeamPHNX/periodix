/* eslint-disable @typescript-eslint/no-explicit-any */

type SduiChatItem = any;
type SduiMessage = any;

export function normalizeForPermissionMatch(value: string): string {
    return value
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
}

export function firstBooleanLike(values: unknown[]): boolean | null {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }

        if (typeof value === 'string') {
            const normalized = normalizeForPermissionMatch(value.trim());
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
        }
    }

    return null;
}

export function containsOneWayRestrictionText(input: string): boolean {
    const normalized = normalizeForPermissionMatch(input)
        .replace(/["']/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return false;

    const hasOneWayTerm =
        normalized.includes('one-way') || normalized.includes('one way');
    const hasAdminWriteRestriction =
        normalized.includes('nur administratoren duerfen schreiben') ||
        normalized.includes('nur gruppen-administratoren duerfen schreiben') ||
        normalized.includes('nur gruppenadministratoren duerfen schreiben');

    return (
        hasAdminWriteRestriction ||
        (hasOneWayTerm &&
            (normalized.includes('duerfen schreiben') ||
                normalized.includes('konversation eroeffnen') ||
                normalized.includes('anklopfen')))
    );
}

export function hasOneWayRestrictionSignal(source: unknown, depth = 0): boolean {
    if (source == null || depth > 6) return false;

    if (typeof source === 'string') {
        return containsOneWayRestrictionText(source);
    }

    if (Array.isArray(source)) {
        return source.some((item) =>
            hasOneWayRestrictionSignal(item, depth + 1),
        );
    }

    if (typeof source !== 'object') return false;

    for (const [rawKey, value] of Object.entries(
        source as Record<string, unknown>,
    )) {
        const key = normalizeForPermissionMatch(rawKey);

        if (typeof value === 'boolean') {
            if (
                value === true &&
                (key.includes('one_way') ||
                    key.includes('oneway') ||
                    key.includes('read_only') ||
                    key.includes('readonly') ||
                    key.includes('broadcast') ||
                    key.includes('announcement'))
            ) {
                return true;
            }

            if (
                value === false &&
                (key.includes('can_write') ||
                    key.includes('canwrite') ||
                    key.includes('can_post') ||
                    key.includes('canpost') ||
                    key.includes('writable') ||
                    key.includes('writeable'))
            ) {
                return true;
            }
        }

        if (
            typeof value === 'number' &&
            value === 0 &&
            (key.includes('can_write') ||
                key.includes('canwrite') ||
                key.includes('can_post') ||
                key.includes('canpost') ||
                key.includes('writable') ||
                key.includes('writeable'))
        ) {
            return true;
        }

        if (typeof value === 'string' && containsOneWayRestrictionText(value)) {
            return true;
        }

        if (
            typeof value === 'object' &&
            hasOneWayRestrictionSignal(value, depth + 1)
        ) {
            return true;
        }
    }

    return false;
}

export function getPathValue(source: any, path: string): unknown {
    return path.split('.').reduce((value: any, segment: string) => {
        if (value == null) return undefined;
        return value[segment];
    }, source);
}

export function getValueMode(values: unknown[]): unknown {
    const counts = new Map<string, { count: number; value: unknown }>();

    for (const value of values) {
        if (
            typeof value !== 'boolean' &&
            typeof value !== 'number' &&
            typeof value !== 'string'
        ) {
            continue;
        }

        const key = `${typeof value}:${String(value)}`;
        const entry = counts.get(key);
        if (entry) {
            entry.count += 1;
        } else {
            counts.set(key, { count: 1, value });
        }
    }

    let mode: unknown = undefined;
    let modeCount = 0;
    for (const entry of counts.values()) {
        if (entry.count > modeCount) {
            mode = entry.value;
            modeCount = entry.count;
        }
    }

    return mode;
}

export function isRestrictivePermissionValue(value: unknown): boolean {
    if (value === false) return true;
    if (typeof value === 'number') return value === 0;

    if (typeof value === 'string') {
        const normalized = normalizeForPermissionMatch(value.trim());
        return (
            normalized.includes('read_only') ||
            normalized.includes('readonly') ||
            normalized.includes('receiver') ||
            normalized.includes('announcement') ||
            normalized.includes('broadcast') ||
            normalized.includes('disabled') ||
            normalized.includes('muted') ||
            normalized.includes('cannot_post') ||
            normalized.includes('no_write')
        );
    }

    return false;
}

export function getExplicitWritePermission(chat: SduiChatItem | null): boolean | null {
    if (!chat) return null;

    const explicitWritePermission = firstBooleanLike([
        chat?.can_write,
        chat?.canWrite,
        chat?.writable,
        chat?.writeable,
        chat?.permissions?.write,
        chat?.permissions?.can_write,
        chat?.permissions?.canWrite,
        chat?.permissions?.post,
        chat?.permissions?.can_post,
        chat?.permissions?.canPost,
        chat?.meta?.can_write,
        chat?.meta?.canWrite,
        chat?.meta?.writable,
        chat?.meta?.writeable,
        chat?.meta?.permissions?.write,
        chat?.meta?.permissions?.can_write,
        chat?.meta?.permissions?.canWrite,
        chat?.meta?.permissions?.post,
        chat?.meta?.permissions?.can_post,
        chat?.meta?.permissions?.canPost,
        chat?.can?.['post-message'],
        chat?.chat?.can?.['post-message'],
        chat?.meta?.can?.['post-message'],
        chat?.chat?.meta?.can?.['post-message'],
    ]);
    if (explicitWritePermission !== null) {
        return explicitWritePermission;
    }

    const explicitReadonly = firstBooleanLike([
        chat?.read_only,
        chat?.readOnly,
        chat?.readonly,
        chat?.is_readonly,
        chat?.isReadOnly,
        chat?.meta?.read_only,
        chat?.meta?.readOnly,
        chat?.meta?.readonly,
        chat?.meta?.is_readonly,
        chat?.meta?.isReadOnly,
        chat?.one_way,
        chat?.oneWay,
        chat?.oneway,
        chat?.chat?.one_way,
        chat?.chat?.oneWay,
        chat?.chat?.oneway,
        chat?.meta?.one_way,
        chat?.meta?.oneWay,
        chat?.meta?.oneway,
    ]);
    if (explicitReadonly === true) {
        return false;
    }

    const roleHint = normalizeForPermissionMatch(
        String(chat?.member?.role ?? chat?.role ?? chat?.meta?.role ?? ''),
    );
    if (
        roleHint.includes('read_only') ||
        roleHint.includes('readonly') ||
        roleHint.includes('receiver')
    ) {
        return false;
    }

    const typeHint = normalizeForPermissionMatch(
        String(chat?.type ?? chat?.meta?.type ?? ''),
    );
    if (typeHint.includes('announcement') || typeHint.includes('broadcast')) {
        return false;
    }

    return null;
}

export function canWriteToChat(
    chat: SduiChatItem | null,
    chats: SduiChatItem[],
    chatDetails: SduiChatItem | null,
    messages: SduiMessage[],
): boolean {
    if (!chat) return false;

    const explicitPermissionFromDetails =
        getExplicitWritePermission(chatDetails);
    if (explicitPermissionFromDetails !== null) {
        return explicitPermissionFromDetails;
    }

    const explicitPermissionFromChat = getExplicitWritePermission(chat);
    if (explicitPermissionFromChat !== null) {
        return explicitPermissionFromChat;
    }

    if (
        hasOneWayRestrictionSignal(chatDetails) ||
        hasOneWayRestrictionSignal(chat) ||
        hasOneWayRestrictionSignal(messages)
    ) {
        return false;
    }

    const referenceChats = chats.filter((item) => item !== chat);
    if (referenceChats.length === 0) {
        return true;
    }

    const comparablePaths = [
        'can.post-message',
        'chat.can.post-message',
        'meta.can.post-message',
        'chat.meta.can.post-message',
        'can.toggle-oneway',
        'chat.can.toggle-oneway',
        'meta.can.toggle-oneway',
        'chat.meta.can.toggle-oneway',
        'permissions.write',
        'permissions.can_write',
        'permissions.canWrite',
        'permissions.post',
        'permissions.can_post',
        'permissions.canPost',
        'meta.permissions.write',
        'meta.permissions.can_write',
        'meta.permissions.canWrite',
        'meta.permissions.post',
        'meta.permissions.can_post',
        'meta.permissions.canPost',
        'read_only',
        'readOnly',
        'readonly',
        'is_readonly',
        'isReadOnly',
        'meta.read_only',
        'meta.readOnly',
        'meta.readonly',
        'meta.is_readonly',
        'meta.isReadOnly',
        'role',
        'member.role',
        'meta.role',
        'type',
        'meta.type',
        'channel_type',
        'meta.channel_type',
    ];

    for (const path of comparablePaths) {
        const selectedValue =
            getPathValue(chatDetails, path) ?? getPathValue(chat, path);
        if (selectedValue == null) continue;

        const referenceValues = referenceChats
            .map((item) => getPathValue(item, path))
            .filter((value) => value != null);
        if (referenceValues.length === 0) continue;

        const referenceMode = getValueMode(referenceValues);
        if (referenceMode == null) continue;

        const selectedIsRestrictive =
            isRestrictivePermissionValue(selectedValue);
        const referenceIsRestrictive =
            isRestrictivePermissionValue(referenceMode);

        if (selectedIsRestrictive && !referenceIsRestrictive) {
            return false;
        }
    }

    return true;
}
