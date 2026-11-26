// Watches what a command uses. Limits come from the plugin through the environment of the launcher; the command cannot change them.
//  - memory: the user keeps RamFreeMb free. The job gets a hard cap that follows the free memory, and is ended when less is left.
//  - disk: the drive keeps DiskFreeMb free, and the project with its cache stays under FoldersMaxMb.
//    Over a limit a command may still run as long as it does not add more than SlackMb (so that the agent can clean up).
//  - a file named STOP in the project ends everything.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class Guard
{
    [StructLayout(LayoutKind.Sequential)] struct MEM { public uint len, load; public ulong total, avail, tp, ap, tv, av, ae; }
    [StructLayout(LayoutKind.Sequential)] struct USE { public ulong now, peak; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
    [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC Basic; public IOC Io; public UIntPtr ProcessMemory, JobMemory, c, d; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref MEM m);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool GetDiskFreeSpaceExW(string d, out ulong mine, out ulong total, out ulong free);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr j, int c, out USE u, int n, IntPtr r);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXTENDED i, int n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr j, uint code);

    const long MB = 1024 * 1024;
    static long Env(string n, long d) { long v; return long.TryParse(Environment.GetEnvironmentVariable("OPENCODE_SANDBOX_" + n), out v) && v >= 0 ? v : d; }
    public static readonly long RamFreeMb = Env("RAM_FREE_MB", 10240);
    static readonly long DiskFreeMb = Env("DISK_FREE_MB", 15360), FoldersMaxMb = Env("FOLDERS_MAX_MB", 15360), SlackMb = 200, WaitMs = Env("RAM_WAIT_MS", 60000);
    static readonly string[] Folders = (Environment.GetEnvironmentVariable("OPENCODE_SANDBOX_FOLDERS") ?? "").Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);

    public static IntPtr Job;
    public static volatile string Reason;
    public static volatile bool Capped;
    static volatile bool done;
    static long diskStart;

    static long Avail() { MEM m = new MEM(); m.len = (uint)Marshal.SizeOf(m); return GlobalMemoryStatusEx(ref m) ? (long)(m.avail / (ulong)MB) : 0; }
    static long Free(string d) { ulong a, b, c; return GetDiskFreeSpaceExW(d, out a, out b, out c) ? (long)(a / (ulong)MB) : long.MaxValue; }

    public static string Before()
    {
        Stopwatch w = Stopwatch.StartNew();
        while (Avail() < RamFreeMb)
        {
            if (w.ElapsedMilliseconds >= WaitMs) return "only " + Avail() + " MB of memory are free and the user keeps " + RamFreeMb + " MB for other programs. Wait and try again later, or do work that needs no shell";
            Thread.Sleep(500);
        }
        foreach (string f in Folders) if (File.Exists(Path.Combine(f, "STOP"))) return "the file STOP is in the project: the user stopped the work";
        if (Folders.Length > 0) diskStart = Free(Folders[0]);
        return null;
    }

    static void Kill(string why)
    {
        if (done || Reason != null) return;
        Reason = why;
        TerminateJobObject(Job, 125);
    }

    static long Size(string dir, ref bool stop)
    {
        long sum = 0;
        try
        {
            foreach (FileSystemInfo i in new DirectoryInfo(dir).EnumerateFileSystemInfos())
            {
                if (done) { stop = true; return sum; }
                if ((i.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                FileInfo f = i as FileInfo;
                try { sum += f != null ? f.Length : Size(i.FullName, ref stop); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return sum;
    }

    static void FolderLoop()
    {
        long first = -1;
        while (!done)
        {
            Stopwatch w = Stopwatch.StartNew();
            long sum = 0; bool stop = false;
            foreach (string f in Folders) sum += Size(f, ref stop);
            if (stop) return;
            sum /= MB;
            if (first < 0) first = sum;
            if (sum > Math.Max(FoldersMaxMb, first + SlackMb))
            {
                Kill("the project and its cache hold " + sum + " MB, the limit is " + FoldersMaxMb + " MB. Delete build output and caches that can be made again, then go on");
                return;
            }
            for (long t = Math.Max(5000, w.ElapsedMilliseconds * 20); t > 0 && !done; t -= 200) Thread.Sleep(200);
        }
    }

    static void Loop()
    {
        EXTENDED e = new EXTENDED();
        long last = -1;
        for (int n = 0; !done; n++)
        {
            USE u;
            long used = QueryInformationJobObject(Job, 28, out u, Marshal.SizeOf(typeof(USE)), IntPtr.Zero) ? (long)(u.now / (ulong)MB) : 0;
            long avail = Avail(), spare = avail - RamFreeMb;
            if (spare < 0 && used > 64) Kill("free memory fell to " + avail + " MB and the user keeps " + RamFreeMb + " MB for other programs (this command used " + used + " MB). Use less memory: smaller runs, fewer at once");
            long cap = Math.Max(used + Math.Max(spare, 0), 64);
            if (last >= 0 && used > last - 32 && used > 64) Capped = true;
            if (last < 0 || Math.Abs(cap - last) > 32)
            {
                e.Basic.LimitFlags = 0x2000 | 0x200; // ends with the launcher, memory cap for the whole job
                e.JobMemory = (UIntPtr)((ulong)cap * (ulong)MB);
                SetInformationJobObject(Job, 9, ref e, Marshal.SizeOf(e));
                last = cap;
            }
            if (n % 5 == 0 && Folders.Length > 0)
            {
                long free = Free(Folders[0]);
                if (free < Math.Min(DiskFreeMb, diskStart - SlackMb)) Kill("only " + free + " MB are free on the drive and the user keeps " + DiskFreeMb + " MB. Delete build output and caches that can be made again");
                foreach (string f in Folders) if (File.Exists(Path.Combine(f, "STOP"))) Kill("the file STOP is in the project: the user stopped the work");
            }
            if (n % 20 == 19) { string s = Secrets.Protect(); if (s != null) Kill(s); }
            Thread.Sleep(100);
        }
    }

    public static void Start()
    {
        foreach (ThreadStart t in new ThreadStart[] { Loop, FolderLoop }) { Thread x = new Thread(t); x.IsBackground = true; x.Start(); }
    }

    public static void Stop() { done = true; }
}
