"use client";

import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { deriveFirstName } from "@/lib/product";
import { useAuth } from "@/hooks/useAuth";

export function UserMenu() {
  const { signOut, user } = useAuth();
  const initials = deriveFirstName(user?.displayName, user?.email).slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-11 rounded-full px-1.5">
          <Avatar className="size-9 border border-border">
            <AvatarImage src={user?.photoURL ?? undefined} alt={user?.displayName ?? user?.email ?? "User"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-normal text-foreground">
              {user?.displayName ?? user?.email ?? "Your account"}
            </p>
            <p className="text-xs font-normal tracking-normal text-muted-foreground">{user?.email ?? "Signed in"}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings2 className="mr-2 size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
