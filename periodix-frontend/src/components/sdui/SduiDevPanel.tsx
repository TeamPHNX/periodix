/* eslint-disable @typescript-eslint/no-explicit-any */
import { SduiRawJsonBlock } from './SduiDevTools';

export function SduiDevPanel({
    isVisible,
    chats,
    selectedChat,
    selectedChatId,
    selectedChatDetails,
    canWriteInSelectedChat,
    oneWayDetected,
    activeTab,
}: {
    isVisible: boolean;
    chats: any[];
    selectedChat: any;
    selectedChatId: string;
    selectedChatDetails: any;
    canWriteInSelectedChat: boolean;
    oneWayDetected: boolean;
    activeTab: 'chats' | 'news';
}) {
    if (!isVisible) return null;

    return (
        <div className="shrink-0 border-b border-indigo-200 bg-indigo-50/60 p-2 dark:border-indigo-900/70 dark:bg-indigo-950/20">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                SDUI Dev Mode: Raw Data
            </div>
            <div className="space-y-2">
                <SduiRawJsonBlock
                    title={`Chats (${chats.length})`}
                    data={chats}
                />
                <SduiRawJsonBlock
                    title={`Selected Chat (${selectedChatId || 'none'})`}
                    data={selectedChat}
                />
                <SduiRawJsonBlock
                    title="Selected Chat Details / Permissions"
                    data={selectedChatDetails}
                />
                <SduiRawJsonBlock
                    title="Active Permission Snapshot"
                    data={{
                        selectedChatId,
                        canWriteInSelectedChat,
                        oneWayDetected,
                        activeTab,
                    }}
                />
            </div>
        </div>
    );
}
