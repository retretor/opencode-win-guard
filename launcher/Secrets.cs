// Closes the files listed in secrets.txt to programs of Low integrity: a mandatory label "no read up, no write up".
// The user's own programs run at Medium and notice nothing. Labels are put back if a program has replaced its file.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

static class Secrets
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s, uint rev, out IntPtr sd, IntPtr len);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr acl, out bool defaulted);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint GetNamedSecurityInfoW(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, out IntPtr sacl, out IntPtr sd);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint rev, uint info, out IntPtr text, IntPtr len);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    const uint LABEL = 0x10;
    static readonly string ListFile = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location)), "secrets.txt");

    static string Label(string path)
    {
        IntPtr sacl, sd, text;
        if (GetNamedSecurityInfoW(path, 1, LABEL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sacl, out sd) != 0) return null;
        string s = null;
        if (ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, LABEL, out text, IntPtr.Zero)) { s = Marshal.PtrToStringUni(text); LocalFree(text); }
        LocalFree(sd);
        return s;
    }

    // The owner of a file may have only "modify" on it, and a label needs the right to change the owner. The owner may grant
    // that to itself: it is granted for the moment and the same rights are put back (Windows may sort the entries).
    static bool Set(string path, string sddl)
    {
        if (SetOnce(path, sddl)) return true;
        if (!File.Exists(path)) return false;
        string old;
        try
        {
            old = File.GetAccessControl(path, AccessControlSections.Access).GetSecurityDescriptorSddlForm(AccessControlSections.Access);
            FileSecurity more = File.GetAccessControl(path, AccessControlSections.Access);
            more.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.TakeOwnership, AccessControlType.Allow));
            File.SetAccessControl(path, more);
        }
        catch (Exception) { return false; }
        try { return SetOnce(path, sddl); }
        finally
        {
            FileSecurity back = new FileSecurity();
            back.SetSecurityDescriptorSddlForm(old, AccessControlSections.Access);
            File.SetAccessControl(path, back);
        }
    }

    static bool SetOnce(string path, string sddl)
    {
        IntPtr sd, acl; bool present, d;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out sd, IntPtr.Zero)) return false;
        bool ok = GetSecurityDescriptorSacl(sd, out present, out acl, out d) && SetNamedSecurityInfoW(path, 1, LABEL, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, acl) == 0;
        LocalFree(sd);
        return ok;
    }

    static bool Closed(string path)
    {
        string l = Label(path);
        return l != null && l.Contains("NR") && (l.Contains(";;;ME)") || l.Contains(";;;HI)") || l.Contains(";;;SI)"));
    }

    static string Root(string line)
    {
        if (line.StartsWith("~\\")) return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + line.Substring(1);
        if (line.StartsWith("%APPDATA%", StringComparison.OrdinalIgnoreCase)) return Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData) + line.Substring(9);
        if (line.StartsWith("%LOCALAPPDATA%", StringComparison.OrdinalIgnoreCase)) return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + line.Substring(14);
        return line;
    }

    // existing files or folders for a line with * in it
    static IEnumerable<string> Expand(string full, bool folder)
    {
        List<string> now = new List<string>();
        string[] parts = full.Split('\\');
        now.Add(parts[0] + "\\");
        for (int i = 1; i < parts.Length; i++)
        {
            bool last = i == parts.Length - 1;
            List<string> next = new List<string>();
            foreach (string d in now)
                try
                {
                    if (parts[i].IndexOf('*') < 0)
                    {
                        string p = Path.Combine(d, parts[i]);
                        if (last && !folder ? File.Exists(p) : Directory.Exists(p)) next.Add(p);
                    }
                    else next.AddRange(last && !folder ? Directory.GetFiles(d, parts[i]) : Directory.GetDirectories(d, parts[i]));
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            now = next;
        }
        return now;
    }

    static void Each(Func<string, bool, bool, bool> f)
    {
        foreach (string raw in File.ReadAllLines(ListFile))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            bool must = line[0] == '!';
            if (must) line = line.Substring(1);
            bool folder = line.EndsWith("\\");
            foreach (string p in Expand(Root(line.TrimEnd('\\')), folder)) if (!f(p, folder, must)) return;
        }
    }

    static bool Close(string p, bool folder)
    {
        bool ok = Closed(p) || Set(p, folder ? "S:(ML;OICI;NWNR;;;ME)" : "S:(ML;;NWNR;;;ME)") && Closed(p);
        if (!folder || !ok) return ok;
        int n = 0;
        try
        {
            foreach (string c in Directory.GetFiles(p, "*", SearchOption.AllDirectories))
            {
                if (++n > 300) break;
                if (!Closed(c) && !Set(c, "S:(ML;;NWNR;;;ME)")) ok = false;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return ok;
    }

    // null when every file that must be closed is closed
    public static string Protect()
    {
        string bad = null;
        try
        {
            Each(delegate(string p, bool folder, bool must)
            {
                if (!Close(p, folder) && must && (folder ? Directory.Exists(p) : File.Exists(p))) bad = "a protected file is open to the sandbox: " + p;
                return bad == null;
            });
        }
        catch (Exception e) { bad = "secrets.txt could not be applied (" + e.Message + ")"; }
        return bad;
    }

    public static int Command()
    {
        string arg = Environment.GetCommandLineArgs().Length > 1 ? Environment.GetCommandLineArgs()[1] : "--list";
        int bad = 0;
        Each(delegate(string p, bool folder, bool must)
        {
            string state;
            if (arg == "--undo")
            {
                bool ok = Set(p, "S:");
                if (folder) foreach (string c in Directory.GetFiles(p, "*", SearchOption.AllDirectories)) ok &= Set(c, "S:");
                state = ok ? "open again" : "FAILED";
            }
            else state = arg == "--apply" ? (Close(p, folder) ? "closed" : "FAILED") : (Closed(p) ? "closed" : "OPEN");
            if (state == "FAILED") bad++;
            Console.WriteLine(state + "  " + p);
            return true;
        });
        return bad == 0 ? 0 : 1;
    }
}
