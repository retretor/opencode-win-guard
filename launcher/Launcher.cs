// Runs a program with a Low integrity token: it can read what the user can read,
// but Windows lets it write, delete or change rights only in folders labelled Low.
// Arguments, console and exit code pass through. No administrator rights are needed.
// Any failure to lower the rights ends with exit code 126: the program is never started with full rights.
// Before that, the files listed in ..\secrets.txt get a label that Low programs cannot read past (see Secrets.cs).
// While the program runs, a guard watches memory and disk (see Guard.cs) and ends everything (exit code 125) at a limit.
using System;
using System.Runtime.InteropServices;
using System.Text;

static class Launcher
{
    [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb; public string r, desktop, title; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2;
        public IntPtr r3, hIn, hOut, hErr;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
    [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr a, b, c, d; }

    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetCommandLineW();
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXTENDED i, int n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSidW(string s, out IntPtr sid);
    [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr t, int cls, ref TOKEN_MANDATORY_LABEL l, int n);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr t, uint flags, int dn, IntPtr d, int pn, IntPtr p, int rn, IntPtr r, out IntPtr n);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUserW(IntPtr t, string app, StringBuilder cmd, IntPtr a, IntPtr b, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "SetInformationJobObject")] static extern bool SetJobUi(IntPtr j, int c, ref uint i, int n);

    static int Fail(string what)
    {
        Console.Error.WriteLine("sandbox: " + what + " failed (" + Marshal.GetLastWin32Error() + "); the command was not run");
        return 126;
    }

    // our own arguments, unchanged, without the program name
    static string Tail()
    {
        string s = Marshal.PtrToStringUni(GetCommandLineW());
        int i = 0;
        if (s.StartsWith("\"")) { i = s.IndexOf('"', 1) + 1; }
        else while (i < s.Length && s[i] != ' ' && s[i] != '\t') i++;
        return s.Substring(i);
    }

    static int Main()
    {
        if (System.IO.Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]).ToLowerInvariant() == "protect") return Secrets.Command();
        string target = Environment.GetEnvironmentVariable("OPENCODE_SANDBOX_SHELL");
        if (string.IsNullOrEmpty(target) || !System.IO.File.Exists(target)) { Console.Error.WriteLine("sandbox: no shell given; the command was not run"); return 126; }
        string open = Secrets.Protect();
        if (open != null) { Console.Error.WriteLine("sandbox: " + open + "; the command was not run"); return 126; }
        string full = Guard.Before();
        if (full != null) { Console.Error.WriteLine("sandbox: " + full + "; the command was not run"); return 125; }
        IntPtr tok, low, sid;
        if (!OpenProcessToken(GetCurrentProcess(), 0x0001 | 0x0002 | 0x0008 | 0x0080, out tok)) return Fail("OpenProcessToken");
        // DISABLE_MAX_PRIVILEGE | LUA_TOKEN: no administrator rights even if OpenCode has them
        if (!CreateRestrictedToken(tok, 0x1 | 0x4, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out low)) return Fail("CreateRestrictedToken");
        if (!ConvertStringSidToSidW("S-1-16-4096", out sid)) return Fail("ConvertStringSidToSid");
        TOKEN_MANDATORY_LABEL label; label.Label.Sid = sid; label.Label.Attributes = 0x20;
        if (!SetTokenInformation(low, 25, ref label, Marshal.SizeOf(label) + GetLengthSid(sid))) return Fail("SetTokenInformation");

        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        EXTENDED e = new EXTENDED(); e.Basic.LimitFlags = 0x2000; // everything it started ends with it
        if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref e, Marshal.SizeOf(e))) return Fail("job");
        uint ui = 0x2 | 0x8 | 0x80; // no reading of the clipboard, no system settings, no shutdown or log off
        if (!SetJobUi(job, 4, ref ui, 4)) return Fail("job limits");
        Guard.Job = job;

        STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.flags = 0x100;
        si.hIn = GetStdHandle(-10); si.hOut = GetStdHandle(-11); si.hErr = GetStdHandle(-12);
        foreach (IntPtr h in new IntPtr[] { si.hIn, si.hOut, si.hErr }) SetHandleInformation(h, 1, 1);
        PROCESS_INFORMATION pi;
        StringBuilder cmd = new StringBuilder("\"" + target + "\"" + Tail());
        if (!CreateProcessAsUserW(low, target, cmd, IntPtr.Zero, IntPtr.Zero, true, 0x4, IntPtr.Zero, null, ref si, out pi)) return Fail("CreateProcessAsUser");
        if (!AssignProcessToJobObject(job, pi.hProcess)) { TerminateProcess(pi.hProcess, 126); return Fail("AssignProcessToJobObject"); }
        Guard.Start();
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        Guard.Stop();
        if (Guard.Reason != null) { Console.Error.WriteLine("sandbox: stopped: " + Guard.Reason); return 125; }
        if (Guard.Capped) Console.Error.WriteLine("sandbox: the command reached the memory limit (the user keeps " + Guard.RamFreeMb + " MB free); use less memory");
        uint code; GetExitCodeProcess(pi.hProcess, out code);
        return unchecked((int)code);
    }
}
