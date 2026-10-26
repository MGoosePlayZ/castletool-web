import { CI, IconButton, Title, Avatar } from "./widgets";
import { cloneDialog } from "@/screens/Home";
import { nav, requestBack } from "@/lib/store";

/** Mobile top bar: 56px slots either side of a centred title. */
export function TopBar({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center px-1.5 py-1">
      <div className="flex justify-start" style={{ width: 56 }}>{left}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center"><Title size={20} className="truncate">{title}</Title></div>
      <div className="flex justify-end" style={{ width: 56 }}>{right}</div>
    </div>
  );
}
export const BackButton = () => <IconButton onClick={() => requestBack()} tooltip="Back"><CI name="left_arrow" size={22} /></IconButton>;
export const CloneButton = () => <IconButton onClick={cloneDialog} tooltip="Clone a deck"><CI name="download2" size={22} /></IconButton>;
export const ProfileButton = () => <IconButton size={44} tooltip="Profile" onClick={() => nav({ profile: true })}><Avatar size={36} /></IconButton>;
